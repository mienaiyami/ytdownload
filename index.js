#!/usr/bin/env ts-node
import fs from "fs";
import { fileTypeFromBuffer } from "file-type";
// import { Readable } from "stream";
import fetch from "node-fetch";
import chalk from "chalk";
import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import sanitize from "sanitize-filename";
const settingsPath = "./settings.json";
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
class YTDownload {
    #downloadQueue = [];
    #bitrate = 256;
    byteToMB(size) {
        return (size / 1024 / 1024).toFixed(2);
    }
    setBitrate(bitrate) {
        if (bitrate >= 32 && bitrate <= 320)
            this.#bitrate = bitrate;
    }
    queueNext(url) {
        if (!url)
            return;
        if (typeof url === "string")
            this.#downloadQueue.push(url);
        else
            this.#downloadQueue.push(...url);
    }
    async start() {
        const { urls_ans } = await inquirer.prompt({
            name: "urls_ans",
            type: "input",
            prefix: chalk.cyanBright("#"),
            message: chalk.greenBright("Enter url or space separated urls:"),
            default: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
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
        this.queueNext(urls);
        const { bitrate } = await inquirer.prompt({
            name: "bitrate",
            type: "list",
            message: chalk.greenBright("Choose a bitrate:"),
            prefix: chalk.cyanBright("#"),
            choices: ["320kbps", "256kbps", "192kbps", "128kbps", "96kbps"],
            default: "256kbps",
            filter(input) {
                return parseInt(input);
            },
        });
        this.setBitrate(bitrate);
        this.startDownload();
    }
    startDownload() {
        console.log(new inquirer.Separator().line);
        if (this.#downloadQueue.length > 0)
            this.#getAudio(this.#downloadQueue.shift());
        else
            console.log(chalk.greenBright("All Downloads Completed."));
    }
    /**
     * if found bitrates are higher #bitrate, choose first higher from bottom.
     */
    async #getAudio(url) {
        // if (!ytdl.validateURL(url)) return console.error("Invalid URL");
        // const dl =await ytdl.getBasicInfo(url)
        // console.log(dl.videoDetails.title);
        // const vid = ytdl(url);
        // vid.on("info",(info)=>{
        //     console.log('Title:',info.videoDetails.title);
        // })
        const info = await ytdl.getInfo(url);
        const audios = ytdl.filterFormats(info.formats, "audioonly");
        if (audios.length === 0)
            return console.error("No audio found.");
        // console.log(
        //     audios.map((e) => ({
        //         audioBitrate: e.audioBitrate,
        //         quality: e.quality,
        //         codecs: e.codecs,
        //     }))
        // );
        const best = [...audios]
            .reverse()
            .find((e) => e.audioBitrate && e.audioBitrate >= this.#bitrate) || audios[0];
        // .map((e) => ({
        //     audioBitrate: e.audioBitrate,
        //     quality: e.quality,
        //     codecs: e.codecs,
        // }))
        // console.log(
        //     info.formats.map((e) => ({
        //         audioBitrate: e.audioBitrate,
        //         quality: e.quality,
        //     }))
        // );
        const title = sanitize(info.videoDetails.title);
        const stream = ytdl.downloadFromInfo(info, { format: best });
        // console.log(info.formats.map(e=>e.container));
        // let audioFormats = ytdl.filterFormats(info.formats, "audioonly");
        // console.log(
        //     audioFormats.map((e) => {
        //         e.;
        //     })
        // );
        // fs.writeFileSync("./data.json", JSON.stringify(audioFormats, null, "\t"));
        // const stream = ytdl(url,{
        //     quality:"highestaudio"
        // })
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
}
// const url = "https://www.youtube.com/watch?v=Yj-jxUpAxmE";
const url = "https://youtu.be/vLZElIYHmAI";
// const url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const dl = new YTDownload();
// dl.downloadAudio(url);
await dl.start();
// https://youtu.be/vLZElIYHmAI https://www.youtube.com/watch?v=aqz-KE-bpKQ
