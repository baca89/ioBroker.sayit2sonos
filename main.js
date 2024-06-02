'use strict';

const utils = require('@iobroker/adapter-core');
const fs = require('fs');
const path = require('path');
const tts = require('./lib/tts');

const options = {
	sayLastVolume: null,
	webLink: '',
	cacheDir: '',
	outFileExt: 'mp3',
};

// const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

class Sayit2sonos extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'sayit2sonos',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.MP3FILE = null;
		this.datadir = null;
		this.weblink = null;
		this.tasks = [];
		this.lastSay = null;
	}

	async onReady() {
		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);

		this.dataDir = path.join(utils.getAbsoluteDefaultDataDir(), 'sayit2Sonos');
		this.MP3FILE = path.normalize(path.join(this.dataDir, `.say.mp3`));

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		if (!this.config.accessKey) {
			this.log.error('accessKey is empty. Please Check your Adapter Configuration');
			return;
		}
		if (!this.config.secretKey) {
			this.log.error('secretKey is empty. Please Check your Adapter Configuration');
			return;
		}

		this.log.debug(
			'Adapter started with Authorization-Key ' +
				this.config.accessKey +
				' and Secret-Key ' +
				this.config.secretKey,
		);

		//Upload custom files
		this.log.silly('now will be upload the announce files');
		await this.uploadFiles();

		if (this.config.cache) {
			if (this.config.cacheDir && (this.config.cacheDir[0] === '/' || this.config.cacheDir[0] === '\\')) {
				this.config.cacheDir = this.config.cacheDir.substring(1);
			}
			this.config.cacheDir = path.join(__dirname, this.config.cacheDir);
			if (this.config.cacheDir) {
				this.config.cacheDir = this.config.cacheDir.replace(/\\/g, '/');
				if (this.config.cacheDir[this.config.cacheDir.length - 1] === '/') {
					this.config.cacheDir = this.config.cacheDir.substring(0, this.config.cacheDir.length - 1);
				}
			} else {
				this.config.cacheDir = '';
			}

			const parts = this.config.cacheDir.split('/');
			let i = 0;
			while (i < parts.length) {
				if (parts[i] === '..') {
					parts.splice(i - 1, 2);
					i--;
				} else {
					i++;
				}
			}

			this.config.cacheDir = parts.join('/');

			//create Cahce-Directory if not exists
			if (!fs.existsSync(this.config.cacheDir)) {
				try {
					this.mkpathSync(`${__dirname}/`, this.config.cacheDir);
					this.log.info(`Directory ${__dirname}/${this.config.cacheDir}created`);
				} catch (error) {
					this.log.error(`Cannot create ${this.config.cacheDir}: ${error.message}`);
				}
			}
		}
		await this.setStateAsync('tts.playing', false, true);

		// calculate weblink for devices
		const obj = await this.getForeignObjectAsync(`system.adapter.${this.config.webInstance}`);

		this.weblink = this.getWebLink(obj, this.config.webServer, this.config.webInstance);

		// update web link on changes
		await this.subscribeForeignObjectsAsync(`system.adapter.${this.config.webInstance}`);

		// initialize tts.text
		let textState;
		try {
			textState = await this.getStateAsync('tts.text');
		} catch (error) {
			//ignore
		}

		if (!textState) {
			await this.setStateAsync('tts.text', '', true);
		}

		// create TTS

		try {
			//TODO: implement addToQueue
			// options.addToQueue = this.addToQueue;
			//TODO: implement getCachedFileName
			// options.getCachedFileName = this.getCachedFileName;
			//TODO: implement is Cached
			// options.isCached = this.isCached;
			options.getWebLink = this.getWebLink;
			options.MP3FILE = this.MP3FILE;
			this.tts = new tts(options);
			// speech2device = new Speech2Device(adapter, options); TODO: rework Spech2Device
		} catch (e) {
			this.log.error(`Cannot initialize engines: ${e.toString()}`);
			return;
		}

		this.setState('info.connection', true, true);
		// TODO: set Commecteion State correctly
		// Set Connection State if Polly connects successfully

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
		// await this.setObjectNotExistsAsync('text', {
		// 	type: 'state',
		// 	common: {
		// 		name: 'Text that has to be spoken',
		// 		type: 'string',
		// 		role: 'text',
		// 		read: true,
		// 		write: true,
		// 	},
		// 	native: {},
		// });

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		// this.subscribeStates('testVariable');
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates('lights.*');
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		this.subscribeStates('*');

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)
		// await this.setStateAsync('testVariable', true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		// await this.setStateAsync('testVariable', { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		// await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		// let result = await this.checkPasswordAsync('admin', 'iobroker');
		// this.log.info('check user admin pw iobroker: ' + result);

		// result = await this.checkGroupAsync('admin', 'admin');
		// this.log.info('check group user admin group admin: ' + result);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (state) {
			this.log.info(`state ${id} changed to value: ${state.val}, ack: ${state.ack}`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === 'object' && obj.message) {
	// 		if (obj.command === 'send') {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info('send command');

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	// 		}
	// 	}
	// }

	mkpathSync(rootpath, dirpath) {
		//Remove Filename
		dirpath = dirpath.split('/');
		dirpath.pop();
		if (!dirpath.length) {
			return;
		}

		for (let i = 0; i < dirpath.length, i++; ) {
			rootpath += `${dirpath[i]}/`;
			if (!fs.existsSync(rootpath)) {
				if (dirpath[i] !== '..') {
					fs.mkdirSync(rootpath);
				} else {
					throw `Cannot create ${rootpath}${dirpath.join('/')}`;
				}
			}
		}
	}

	getWebLink(obj, webServer, webInstance) {
		let webLink = '';
		if (obj && obj.native) {
			webLink = 'http';
			if (obj.native.auth) {
				this.log.error(`Cannot use server ${obj._id} with authentication. Select other or create another one.`);
			} else {
				if (obj.native.secure) {
					webLink += 's';
				}
				webLink += '://';
				if (obj.native.bind === 'localhost' || obj.native.bind === '127.0.0.1') {
					this.log.error(
						`Selected web server "${obj._id}" is only on local device available. Select other or create another one.`,
					);
				} else {
					if (obj.native.bind === '0.0.0.0') {
						webLink += webServer || this.config.webServer;
					} else {
						webLink += obj.native.bind;
					}
				}
				webLink += `:${obj.native.port}`;
			}
		} else {
			this.log.error(
				`Cannot read information about "${webInstance || this.config.webInstance}". No web server is active`,
			);
		}
		return webLink;
	}

	async uploadFile(file) {
		this.log.silly('Datei wird in Verzeichnis geladen.');
		try {
			const stat = fs.statSync(path.join(`${__dirname}/mp3/`, file));

			if (!stat.isFile()) {
				//ignore -> not a file
				return;
			}
		} catch (error) {
			//ignore, not a file
			return;
		}

		let data;
		try {
			data = await this.readFileAsync(this.namespace, `tts.userfiles/${file}`);
		} catch (error) {
			// ignore error
		}

		if (!data) {
			try {
				await this.writeFileAsync(
					this.namespace,
					`tts.userfiles/${file}`,
					fs.readFileSync(path.join(`${__dirname}/mp3/`, file)),
				);
			} catch (error) {
				this.log.error(`Cannot write file "${__dirname}/mp3/${file}": ${error.toString()}`);
			}
		}
	}

	async uploadFiles() {
		this.log.silly('mp3-Dateien werden hochgeladen.');
		this.log.silly(`Pfad lautet: ${__dirname}/mp3`);
		if (fs.existsSync(`${__dirname}/mp3`)) {
			this.log.info('Upload announce mp3 files');
			let obj;
			try {
				obj = await this.getForeignObjectAsync(this.namespace);
			} catch (error) {
				//ignore
			}

			if (!obj) {
				await this.setForeignObjectAsync(this.namespace, {
					type: 'meta',
					common: { name: 'User files for SayIt', type: 'meta.user' },
					native: {},
				});
			}
			const files = fs.readdirSync(`${__dirname}/mp3`);
			for (let f = 0; f < files.length; f++) {
				await this.uploadFile(files[f]);
			}
		} else {
			this.log.silly('pfad für Mp3´s existiert nicht.');
		}
	}
	/**
	 * @param {string} text
	 * @param {any} language
	 * @param {any} volume
	 * @param {any} onlyCache
	 */
	addToQueue(text, language, volume, onlyCache) {
		// Extract language from "en;volume;Text to say"

		if (text.includes(';')) {
			const arr = text.split(';', 3);
			//If language;text or volume;text
			if (arr.length === 2) {
				// If number
				if (parseInt(arr[0]).toString() === arr[0].toString()) {
					volume = arr[0].trim();
				} else {
					language = arr[0].trim();
				}
				text = arr[1].trim();
			} else if (arr.length === 3) {
				// If language;volume;text or volume;language;text
				// If number
				if (parseInt(arr[0]).toString() === arr[0].toString()) {
					volume = arr[0].trim();
					language = arr[1].trim();
				} else {
					volume = arr[1].trim();
					language = arr[0].trim();
				}
				text = arr[2].trim();
			}
		}
		// Workaround for double text
		// find all similar texts with interval less han 500 ms
		const combined = [text, language, volume].filter((t) => t).join(';');
		if (this.tasks.find((task) => task.combined === combined && Date.now() - task.ts < 500)) {
			// ignore it
			return;
		}

		const hightPriority = text.startsWith('!');

		volume = parseInt(volume || this.config.volume, 10);
		if (Number.isNaN(volume)) {
			volume = undefined;
		}

		const task = { text, language, volume, onlyCache, ts: Date.now(), combined };

		// If more time than 15 seconds till last text, add announcement
		if (
			!onlyCache &&
			this.config.announce &&
			!this.tasks.length &&
			(!this.lastSay || Date.now() - this.lastSay > this.config.annoTimeout * 1000)
		) {
			//place as first the announcement mp3-file
			this.tasks.push({ text: this.config.announce });
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Sayit2sonos(options);
} else {
	// otherwise start the instance directly
	new Sayit2sonos();
}
