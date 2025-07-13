import KV from './kv.ts';
import { decodeJWT } from './utils.ts';
import { decode } from "https://deno.land/std@0.95.0/encoding/base64url.ts";
const crypto = await import('node:crypto');

export async function authorize(hash, sig) {
	let found_profile = (await KV.get(['profile', hash]))?.value;

	if (!found_profile) {
		return {public: true, valid: false};
	} else if (sig) {
		let sig_profile = (await KV.get(['signature', sig]))?.value;

		if (sig_profile?.username == hash)  {
			return {...sig_profile, public: false, valid: true};
		}
	}

	return {valid: false};
}

export async function verifyJwt(jwt) {
    if (!jwt) return {error: 'E403_jwt'};

    try {
        let verified = false;
        let profile = decodeJWT(jwt);
        let jwks = (await fetch('https://www.googleapis.com/oauth2/v3/certs').then(r => r.json()).catch(null))?.keys;

        // split the token into it's parts for verifcation
        const [headerb64, payloadb64, signatureb64] = jwt.split(".")
        const encoder = new TextEncoder()
        const data = encoder.encode(headerb64 + '.' + payloadb64)
        let signature = decode(signatureb64);

        for (let jwk of jwks) {
            const key = await crypto.subtle.importKey(
                "jwk",
                jwk,
                {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
                true,
                ["verify"],
            );

            let flag = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
            verified = verified || flag;
        }

        verified = verified
            && (profile.iss?.includes('accounts.google.com'))
            // This is the new security measure
            && (profile.aud == '547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com')
            && (new Date((profile.exp||1)*1e3) > Date.now());

        let username = profile?.email.replace('gmail.com', '').replace(/[\@\.]/g, '');

        profile = {username, verified, jwt, signature: profile.jti, ...profile};

        KV.set(['signature', profile.jti], profile);
        KV.set(['profile', username], profile);

        return profile;
    } catch (error) {
        console.log(error)
        return {error};
    }
}
