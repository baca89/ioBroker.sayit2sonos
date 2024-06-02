'use strict';
const utils = require('@iobroker/adapter-core');
const fs = require('fs');
const path = require('path');
const tts = require('./lib/tts');
const process = require('process');

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

		this.engine = null;
		this.lang = null;
		this.options = {};
	}

	async onReady() {
		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);

		if (
			(process.argv && process.argv.includes('--install')) ||
			((!process.argv || !process.argv.includes('--force')) &&
				(!this.common || !this.common.enabled) &&
				!process.argv.includes('--debug'))
		) {
			this.log.info('Install process. Upload files and stop.');
			await this.uploadFiles();
			if (this.stop) {
				this.stop();
			} else {
				process.exit();
			}
		} else {
			await this.uploadFiles();
			await this.main();
			this.subscribeStates('*');
		}
	}

	/**
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

	/**
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

	/**
	 * @this {any}
	 */
	async main() {
		const systemConfig = await this.getForeignObjectAsync('system.config');

		if (!this.engine) {
			this.engine = (systemConfig && systemConfig.common && systemConfig.common.language) || 'de';
		}
		this.lang = (systemConfig && systemConfig.common && systemConfig.common.language) || 'de';
		this.dataDir = path.join(utils.getAbsoluteDefaultDataDir(), 'sayit2sonos');
		this.MP3FILE = path.normalize(path.join(this.dataDir, `${this.namespace}.say.mp3`));
		this.options.outFileExt = 'mp3';

		await this.prepareAnnounceFiles();

		//if cache enabled
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

			//creates cache-direcrory, if does not exists
			if (!fs.existsSync(this.config.cacheDir)) {
				try {
					this.mkpathSync(`${__dirname}/`, this.config.cacheDir);
				} catch (error) {
					this.log.error(`Cannot create "${this.config.cacheDir}": ${error.message}`);
				}
			}
		}
		// initialize tts.text
		await this.setStateAsync('tts.playing', false, true);

		// calculate weblink
		const obj = await this.getForeignObjectAsync(`system.adapter.${this.config.webInstance}`);
		this.options.webLink = await this.getWebLink(obj, this.config.webServer, this.config.webInstance);

		// update web link on changes
		await this.subscribeForeignObjectsAsync(`system.adapter.${this.config.webInstance}`);

		// initialize tts.text
		let textState;
		try {
			textState = await this.getStateAsync('tts.text');
		} catch (e) {
			// ignore
		}

		if (!textState) {
			await this.setStateAsync('tts.text', '', true);
		}

		// create Text2Speech
		try {
			this.options.addToQueue = this.addToQueue;
			this.options.getCachedFileName = this.getCachedFileName;
			this.options.isCached = this.isCached;
			this.options.getWebLink = this.getWebLink;
			this.options.MP3FILE = this.MP3FILE;
			this.text2speech = new tts();
		} catch (error) {
			this.log.error(`Cannot initialize engines: ${error.toString()}`);
			return;
		}
	}

	async uploadFiles() {
		this.log.info('mp3-Dateien werden hochgeladen.');
		this.log.info(`Pfad lautet: ${__dirname}/mp3`);
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
			this.log.info('pfad für Mp3´s existiert nicht.');
		}
	}

	/**
	 * @param {string} file
	 */
	async uploadFile(file) {
		this.log.info('Datei wird in Verzeichnis geladen.');
		try {
			this.log.debug(`trying upload File ${file}`);
			const stat = fs.statSync(path.join(`${__dirname}/mp3/`, file));

			if (!stat.isFile()) {
				this.log.warn(`file ${file} is not a valid file`);
				return;
			}
		} catch (error) {
			this.log.debug('is not a file');
			return;
		}

		let data;
		try {
			data = await this.readFileAsync(this.namespace, `tts.userfiles/${file}`);
		} catch (error) {
			this.log.debug('kann datei nicht lesen');
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

	async prepareAnnounceFiles() {
		this.log.info('preparing announcement files');
		if (this.config.announce) {
			//remove "tts.userfiles/ from file Name"
			const fileName = this.config.announce.split('/').pop();

			// @ts-ignore
			if (!fs.existsSync(path.join(__dirname, fileName))) {
				try {
					const data = await this.readFileAsync(this.namespace, `tts.userfiles/${fileName}`);
					if (data) {
						try {
							// @ts-ignore
							fs.writeFileSync(path.join(__dirname, fileName), data);
						} catch (error) {
							this.log.error(`Cannot write file: ${error.toString()}`);
							this.config.announce = '';
						}
					}
				} catch (error) {
					this.log.error(`Cannot read file: ${error.toString()}`);
					this.config.announce = '';
				}
			} else {
				// @ts-ignore
				this.config.announce = path.join(__dirname, fileName);
			}
		}
	}

	mkpathSync(rootpath, dirpath) {
		//Remove Filename
		// @ts-ignore
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

	async getWebLink(obj, webServer, webInstance) {
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

	async addToQueue() {
		//TODO: addToQueue mit leben füllen
	}

	async getCachedFileName() {
		// TODO: getCachedFileName mit Leben füllen
	}

	async isCached() {
		//TODO: isCached mit Leben füllen
	}
} // End of Class

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
