import { decode } from "https://deno.land/std@0.95.0/encoding/base64url.ts";

export function decodeJWT(token) {
	try {
		// console.log('decodeJWT', token)
		const base64Url = token.split('.')[1];
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
			return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
		}).join(''));

		return JSON.parse(jsonPayload);
	} catch { return {}}
}
