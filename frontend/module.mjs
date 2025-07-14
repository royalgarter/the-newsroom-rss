// import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.x.x';

try {
	/*const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
	const vector = await embedder('rss');

	if (embedder) {
		window.embedder = embedder;
		console.log('window.embedder is loaded');
	}*/

	/*const translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M');
	const translated = await translator('We just decided: The first step in fixing the world is to Be Informed. Get curated news, delivered your way: fast, personalized RSS.', {
	  src_lang: 'eng_Latn',
	  tgt_lang: 'vie_Latn',
	});
	console.log({translated});*/

	/*const translator = await pipeline('translation', 'Xenova/m2m100_418M');
	const translated = await translator('We just decided: The first step in fixing the world is to Be Informed. Get curated news, delivered your way: fast, personalized RSS.', {
	  src_lang: 'en',
	  tgt_lang: 'vi',
	});
	console.log({translated});*/

	/*const generator = await pipeline(
		"text-generation",
		"onnx-community/gemma-3-1b-it-ONNX-GQA",
		{ dtype: "q4f16" },
	);

	const messages = [
		{ role: "system", content: "You are a helpful assistant." },
		{ role: "user", content: "Write me a poem about Machine Learning." },
	];

	const output = await generator(messages, { max_new_tokens: 512, do_sample: false });
	console.log(output[0].generated_text.at(-1).content);*/

} catch (ex) { console.log(ex) }