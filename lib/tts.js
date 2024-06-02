'use strict';

class TTS {
	constructor(options) {
		this.addToQueue = options.addToQueue;
		this.getCachedFileName = options.getCachedFileName;
		this.isCached = options.isCached;
		this.MP3FILE = options.MP3FILE;
		this.polly = null;
	}
}

module.exports = TTS;
