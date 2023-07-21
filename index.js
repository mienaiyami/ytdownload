#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileTypeFromBuffer } from "file-type";
// import { Readable } from "stream";
import fetch from "node-fetch";
import chalk from "chalk";
import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
if (ffmpegPath)
    ffmpeg.setFfmpegPath(ffmpegPath);
import sanitize from "sanitize-filename";
import { Command, Option } from "commander";
import dotenv from "dotenv";
dotenv.config();
const pkgJSON = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const program = new Command();
const settingsPath = path.resolve("./settings.json");
const qualityOrder = [
    "144p",
    "240p",
    "360p",
    "480p",
    "720p",
    "720p60",
    "1080p",
    "1080p60",
];
program
    .name("yt-downloader")
    .description(`CLI to download mp3/mp4 from youtube.
Run with or without args.
If you are getting low download speed try adding cookies to ".env" file or using command given below.
By ${chalk.greenBright("https://github.com/mienaiyami")}`)
    .version(pkgJSON.version)
    .addHelpText("afterAll", `
Access settings at ${chalk.greenBright(settingsPath)}.
    `);
program
    .addOption(new Option("-l, --link <string>", "Link of youtube video"))
    .addOption(new Option("-m, --links <items>", "Multiple comma separated links.").argParser((value) => value.split(",").filter((e) => ytdl.validateURL(e))))
    .addOption(new Option("-a, --audio", "Download mp3"))
    .addOption(new Option("-v, --video", "Download mp4"))
    .addOption(new Option("-b, --bitrate <size>", "Bitrate of audio in kbps.").argParser(parseInt))
    .addOption(new Option("-q, --quality <option>", `Video quality`).choices(qualityOrder))
    .addOption(new Option("--suffixBitrate <boolean>", "Suffix bitrate after mp3 title. ex. title_160kbps.mp3"))
    .addOption(new Option("--makeAlbumArt <boolean>", "Embed video thumbnail as album art on .mp3."))
    .addOption(new Option("-c, --cookies <string>", `Set cookies for a bit faster download or to access private videos. Need to change regularly. Go to ${chalk.greenBright("https://www.youtube.com/")}, ctrl+shift+i, type ${chalk.greenBright("document.cookies")}, copy and paste whole result.`));
const defaultSettings = {
    /**
     * suffix bitrate on file name, ex. `abc._320kbps.mp3`
     */
    suffixBitrate: false,
    makeAlbumArt: true,
};
const makeSetting = () => {
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, "\t"));
    return defaultSettings;
};
try {
    JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}
catch {
    console.error(chalk.redBright("Invalid settings, rewriting..."));
    makeSetting();
}
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const validateSettings = () => {
    let changed = false;
    for (const key in defaultSettings) {
        if (!(key in settings)) {
            changed = true;
            console.warn(chalk.yellowBright(`Adding missing key "${key}" on settings.`));
            settings[key] =
                defaultSettings[key];
        }
        else if (typeof settings[key] !==
            typeof defaultSettings[key]) {
            changed = true;
            console.warn(chalk.yellowBright(`Fixing invalid key "${key}" on settings.`));
            settings[key] =
                defaultSettings[key];
        }
    }
    if (changed)
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"));
};
validateSettings();
if (!fs.existsSync("./downloads"))
    fs.mkdirSync("./downloads");
if (!fs.existsSync("./downloads/mp3"))
    fs.mkdirSync("./downloads/mp3");
if (!fs.existsSync("./downloads/mp4"))
    fs.mkdirSync("./downloads/mp4");
const FORMATS = ["audio/mp3", "video/mp4"];
class YTDownload {
    #downloadQueue = [];
    #bitrate = 256;
    #downloadQuality = "720p";
    byteToMB(size) {
        return (size / 1024 / 1024).toFixed(2);
    }
    setBitrate(bitrate) {
        if (bitrate >= 32 && bitrate <= 320)
            this.#bitrate = bitrate;
    }
    setQuality(quality) {
        if (qualityOrder.includes(quality))
            this.#downloadQuality = quality;
    }
    // formatTime(time: number[]): number {
    //     return time[0] * 60 * 60 + time[1] * 60 + time[2];
    // }
    queueNext(url, format) {
        if (!url || !format)
            return;
        if (typeof url === "string")
            this.#downloadQueue.push({ url, format });
        else
            this.#downloadQueue.push(...url.map((e) => ({ url: e, format })));
    }
    async start(options) {
        if (Object.keys(options).length > 0) {
            if (options.quality)
                this.setQuality(options.quality);
            if (options.bitrate)
                this.setBitrate(options.bitrate);
            if (options.link && ytdl.validateURL(options.link)) {
                if (options.audio) {
                    this.queueNext(options.link, "audio/mp3");
                    this.startDownload();
                }
                if (options.video) {
                    this.queueNext(options.link, "video/mp4");
                    this.startDownload();
                }
            }
            if (options.links) {
                if (options.bitrate)
                    this.setBitrate(options.bitrate);
                if (options.audio) {
                    this.queueNext(options.link, "audio/mp3");
                    this.startDownload();
                }
                if (options.video) {
                    this.queueNext(options.link, "video/mp4");
                    this.startDownload();
                }
            }
            return;
        }
        const { urls_ans } = await inquirer.prompt({
            name: "urls_ans",
            type: "input",
            prefix: chalk.cyanBright("#"),
            message: chalk.greenBright("Enter url or space separated urls:"),
            validate: (input) => {
                if (!input)
                    return false;
                const urls = input.split(" ").filter((e) => e);
                for (const e of urls) {
                    if (!ytdl.validateURL(e))
                        return "Invalid URL";
                }
                return true;
            },
        });
        const urls = [
            ...new Set(urls_ans.split(" ").filter((e) => e)),
        ];
        const { format } = await inquirer.prompt({
            name: "format",
            type: "list",
            message: chalk.greenBright("Choose a format:"),
            prefix: chalk.cyanBright("#"),
            choices: FORMATS,
            default: 0,
        });
        const { bitrate } = await inquirer.prompt({
            name: "bitrate",
            type: "list",
            message: chalk.greenBright("Choose audio bitrate:"),
            prefix: chalk.cyanBright("#"),
            choices: [
                "320kbps",
                "256kbps",
                "192kbps",
                "160kbps",
                "128kbps",
                "96kbps",
                "64kbps",
                "48kbps",
            ],
            default: "128kbps",
            filter(input) {
                return parseInt(input);
            },
        });
        if (format === FORMATS[1]) {
            const { quality } = await inquirer.prompt({
                name: "quality",
                type: "list",
                message: chalk.greenBright("Choose video quality:"),
                prefix: chalk.cyanBright("#"),
                choices: qualityOrder,
                default: "720p",
            });
            this.setQuality(quality);
        }
        // let rangeStart = [0, 0, 0];
        // let rangeEnd = [0, 0, 0];
        // if (urls.length === 1) {
        //     const getRange = async (name: string) =>
        //         (
        //             await inquirer.prompt({
        //                 name: name,
        //                 type: "input",
        //                 message: chalk.greenBright(
        //                     "Choose starting time or click Enter:"
        //                 ),
        //                 prefix: chalk.cyanBright("#"),
        //                 default: "00:00:00",
        //                 validate(input: any) {
        //                     if (input instanceof Array) {
        //                         return true;
        //                     }
        //                     return "Invalid Input";
        //                 },
        //                 transformer(input: any, ans, flag) {
        //                     if (flag.isFinal && input && input instanceof Array)
        //                         return input.join(":");
        //                     return input || "";
        //                 },
        //                 filter(input: string) {
        //                     try {
        //                         const abc = input
        //                             .split(":")
        //                             .map((e) => parseInt(e))
        //                             .filter((e) => !isNaN(e));
        //                         if (abc.length === 3) {
        //                             if (
        //                                 !(
        //                                     abc[0] < 0 ||
        //                                     abc[1] < 0 ||
        //                                     abc[1] > 60 ||
        //                                     abc[2] < 0 ||
        //                                     abc[2] > 60
        //                                 )
        //                             )
        //                                 return abc;
        //                         }
        //                         return input;
        //                     } catch {
        //                         return input;
        //                     }
        //                 },
        //             })
        //         )[name];
        //     rangeStart = await getRange("rangeStart");
        //     rangeEnd = await getRange("rangeEnd");
        // }
        this.queueNext(urls, format);
        this.setBitrate(bitrate);
        if (format === FORMATS[0]) {
            this.startDownload();
        }
        else if (format === FORMATS[1]) {
            if (urls.length > 1)
                console.log(chalk.yellowBright("More than one URL, some options will be hidden."));
            this.startDownload();
        }
    }
    startDownload() {
        console.log(new inquirer.Separator().line);
        if (this.#downloadQueue.length > 0) {
            console.log(chalk.greenBright("Queue:"), this.#downloadQueue.length);
            const current = this.#downloadQueue.shift();
            console.log(chalk.greenBright("Link :"), current?.url);
            if (current?.format === "audio/mp3")
                this.#getAudio(current?.url);
            if (current?.format === "video/mp4")
                this.#getVideo(current?.url);
        }
        else
            console.log(chalk.greenBright("All Downloads Completed. Available at", path.resolve("./downloads")));
    }
    /**
     * if found bitrates are higher #bitrate, choose first higher from bottom.
     */
    async #getAudio(url) {
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    cookie: process.env.COOKIES,
                },
            },
        });
        // fs.writeFileSync("test.json", JSON.stringify(info.formats, null, "\t"));
        const audios = ytdl.filterFormats(info.formats, "audioonly");
        if (audios.length === 0)
            return console.error("No audio found.");
        const best = [...audios]
            .reverse()
            .find((e) => e.audioBitrate && e.audioBitrate >= this.#bitrate) || audios[0];
        const title = sanitize(info.videoDetails.title);
        console.log(process.env.COOKIES);
        const stream = ytdl.downloadFromInfo(info, {
            format: best,
            requestOptions: {
                headers: {
                    cookie: process.env.COOKIES,
                },
            },
        });
        console.log(chalk.greenBright("Title:"), title);
        console.log(chalk.greenBright("Started:"), new Date().toLocaleTimeString());
        const spinner = createSpinner("Starting Download...").start();
        const filename = `./downloads/mp3/${title}${settings.suffixBitrate ? `_${this.#bitrate}kbps` : ""}.mp3`;
        stream.on("progress", (e, downloaded, total) => {
            spinner.update({
                text: `${this.byteToMB(downloaded)} / ${this.byteToMB(total)}MB`,
            });
        });
        stream.on("error", (err) => {
            spinner.error({ text: err.message });
        });
        let thumbPath = `./downloads/mp3/${title}`;
        if (settings.makeAlbumArt) {
            const raw_thumb = await fetch(info.videoDetails.thumbnails.at(-1).url);
            const arraybuffer_thumb = await raw_thumb.arrayBuffer();
            const buffer_thumb = Buffer.from(arraybuffer_thumb);
            const type = await fileTypeFromBuffer(buffer_thumb);
            // if (type) thumbPath += type.ext;
            fs.writeFileSync(thumbPath, buffer_thumb);
        }
        const ffmpegCommand = ffmpeg(stream)
            .audioBitrate(this.#bitrate)
            .outputOption("-id3v2_version", "3")
            //replace(/'/g, "\\'")
            .outputOption("-metadata", `title=${info.videoDetails.title}`)
            .outputOption("-metadata", `artist=${info.videoDetails.author.name}`);
        if (settings.makeAlbumArt && fs.existsSync(thumbPath))
            ffmpegCommand
                .input(thumbPath)
                .outputOption("-map", "0:0")
                .outputOption("-map", "1:0");
        ffmpegCommand
            .save(filename)
            .on("error", (err) => {
            spinner.error({ text: err.message });
            // console.log(err);
            if (fs.existsSync(thumbPath))
                fs.rmSync(thumbPath);
            this.startDownload();
        })
            .on("end", () => {
            spinner.success();
            console.log(chalk.greenBright("Downloaded:"), new Date().toLocaleTimeString());
            if (fs.existsSync(thumbPath))
                fs.rmSync(thumbPath);
            this.startDownload();
        });
    }
    async #getVideo(url) {
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    cookie: process.env.COOKIES,
                },
            },
        });
        const videos = ytdl.filterFormats(info.formats, (format) => format.qualityLabel &&
            format.container === "mp4" &&
            !format.hasAudio);
        if (videos.length === 0)
            return console.error("No video found.");
        let quality = 4;
        let bestVideo;
        while (true) {
            bestVideo = videos.find((e) => e.qualityLabel === this.#downloadQuality);
            if (bestVideo)
                break;
            quality--;
            if (quality < 0)
                break;
            console.warn(chalk.yellowBright(`${qualityOrder[quality + 1]} not found, trying ${qualityOrder[quality]}`));
        }
        // fs.writeFileSync(
        //     "test.json",
        //     JSON.stringify(
        //         videos.map((e) => [
        //             e.codecs,
        //             e.qualityLabel,
        //             e.container,
        //             e.mimeType,
        //             e.url,
        //             e.hasAudio,
        //         ]),
        //         null,
        //         "\t"
        //     )
        // );
        if (bestVideo === undefined) {
            console.error(chalk.redBright("Video not found."));
            this.startDownload();
            return;
        }
        const videoStream = ytdl.downloadFromInfo(info, {
            format: bestVideo,
            requestOptions: {
                headers: {
                    cookie: process.env.COOKIES,
                },
            },
        });
        const audios = ytdl.filterFormats(info.formats, "audioonly");
        if (audios.length === 0)
            return console.error("No audio found.");
        const bestAudio = [...audios]
            .reverse()
            .find((e) => e.audioBitrate && e.audioBitrate >= this.#bitrate) || audios[0];
        const audioStream = ytdl.downloadFromInfo(info, {
            format: bestAudio,
            requestOptions: {
                headers: {
                    cookie: process.env.COOKIES,
                },
            },
        });
        const title = sanitize(info.videoDetails.title);
        console.log(chalk.greenBright("Title:"), title);
        console.log(chalk.greenBright("Started:"), new Date().toLocaleTimeString());
        const spinner = createSpinner("Starting Download...").start();
        const filename = `./downloads/mp4/${title}${""
        // settings.suffixBitrate ? `_${this.#bitrate}kbps` : ""
        }.mp4`;
        const tempAudio = "./downloads/temp.mp3";
        const tempVideo = "./downloads/temp.mp4";
        const progress = {
            video: 0,
            audio: 0,
            videoTotal: 0,
            audioTotal: 0,
            // so downloadSuccess dont get called twice
            finished: false,
        };
        const update = () => {
            spinner.update({
                text: `Audio: ${this.byteToMB(progress.audio)} / ${this.byteToMB(progress.audioTotal)} MB\n` +
                    `  Video: ${this.byteToMB(progress.video)} / ${this.byteToMB(progress.videoTotal)} MB`,
            });
        };
        const downloadSuccess = () => {
            if (!progress.finished &&
                progress.audio === progress.audioTotal &&
                progress.video === progress.videoTotal) {
                progress.finished = true;
                spinner.success();
                console.log(chalk.greenBright("Downloaded:"), new Date().toLocaleTimeString());
                setTimeout(() => {
                    const buildSpinner = createSpinner().start({
                        text: "Building...",
                    });
                    ffmpeg()
                        .input(tempVideo)
                        .input(tempAudio)
                        .addOption(["-c:v", "copy"])
                        .addOption(["-c:a", "aac"])
                        // .addOption(["-map", "0:v:0"])
                        // .addOption(["-map", "1:a:0"])
                        .output(filename)
                        .on("error", (err) => {
                        buildSpinner.error({ text: err.message });
                        // console.log(err);
                        this.startDownload();
                    })
                        .on("end", () => {
                        buildSpinner.success();
                        console.log(chalk.greenBright("Built:"), new Date().toLocaleTimeString());
                        this.startDownload();
                    })
                        .run();
                }, 500);
            }
        };
        audioStream.on("progress", (e, downloaded, total) => {
            progress.audio = downloaded;
            progress.audioTotal = total;
            update();
            // spinner.update({
            //     text: `${(downloaded)} / ${(
            //         total
            //     )}MB`,
            // });
        });
        videoStream.on("progress", (e, downloaded, total) => {
            progress.video = downloaded;
            progress.videoTotal = total;
            update();
            // spinner.update({
            //     text: `${(downloaded)} / ${(
            //         total
            //     )}MB`,
            // });
        });
        const ffmpegCommand_Audio = ffmpeg(audioStream)
            .audioBitrate(this.#bitrate)
            .save(tempAudio)
            .on("error", (err) => {
            spinner.error({ text: err.message });
            // console.log(err);
            // this.startDownload();
            process.exit(1);
        })
            .on("end", () => {
            downloadSuccess();
        });
        const ffmpegCommand_Video = ffmpeg(videoStream)
            .save(tempVideo)
            .on("error", (err) => {
            spinner.error({ text: err.message });
            // console.log(err);
            // this.startDownload();
            process.exit(1);
        })
            .on("end", () => {
            downloadSuccess();
        })
            .noAudio();
    }
}
const dl = new YTDownload();
program.parse(process.argv);
if (program.opts().cookies) {
    fs.writeFileSync("./.env", `COOKIES="${program.opts().cookies}"`);
    console.log(chalk.greenBright("Cookies added."));
    process.exit(0);
}
if ("suffixBitrate" in program.opts() || "makeAlbumArt" in program.opts()) {
    if ("suffixBitrate" in program.opts())
        settings.suffixBitrate = JSON.parse(program.opts().suffixBitrate);
    if ("makeAlbumArt" in program.opts())
        settings.makeAlbumArt = JSON.parse(program.opts().makeAlbumArt);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"));
    process.exit(0);
}
await dl.start(program.opts());
// test https://www.youtube.com/watch?v=aqz-KE-bpKQ
// https://www.youtube.com/watch?v=2x0WL5GDrfs
