// Thumbnail resizer: pure-WASM (@jsquash), no native deps. Output: WebP, max THUMB_W wide.
import { decode as decodeJpeg } from '@jsquash/jpeg';
import { decode as decodePng } from '@jsquash/png';
import { decode as decodeWebp, encode as encodeWebp } from '@jsquash/webp';
import resize from '@jsquash/resize';

export const THUMB_W = 640;

const decoders: Record<string, (b: ArrayBuffer) => Promise<ImageData | null>> = {
	'image/jpeg': decodeJpeg,
	'image/jpg': decodeJpeg,
	'image/png': decodePng,
	'image/webp': decodeWebp,
};

/** Returns resized WebP bytes, or null if format unsupported (gif/svg/avif) or on any failure. */
export async function resizeThumb(buf: Uint8Array, contentType: string, width = THUMB_W): Promise<Uint8Array | null> {
	const decode = decoders[contentType.split(';')[0].trim().toLowerCase()];
	if (!decode) return null;
	try {
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
		const img = await decode(ab);
		if (!img) return null;
		const out = img.width > width
			? await resize(img, { width, height: Math.round(img.height * width / img.width) })
			: img;
		return new Uint8Array(await encodeWebp(out, { quality: 75 }));
	} catch (e) {
		console.error('resizeThumb failed:', e);
		return null;
	}
}
