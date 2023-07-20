import fs from "fs";
import chalk from "chalk";
import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import sanitize from "sanitize-filename";

if (!fs.existsSync("./downloads")) fs.mkdirSync("./downloads");
if (!fs.existsSync("./downloads/mp3")) fs.mkdirSync("./downloads/mp3");
if (!fs.existsSync("./downloads/mp4")) fs.mkdirSync("./downloads/mp4");

class YTDownload {
    #downloadQueue = [] as string[];
    byteToMB(size: number) {
        return (size / 1024 / 1024).toFixed(2);
    }
    queueNext(link: string | string[]) {
        if (!link) return;
        if (typeof link === "string") this.#downloadQueue.push(link);
        else this.#downloadQueue.push(...link);
    }
    start() {}
    downloadAudio(link: string | string[]): void {
        if (typeof link === "string") this.getAudio(link);
    }
    async getAudio(link: string) {
        if (!ytdl.validateURL(link)) return console.error("Invalid URL");
        // const dl =await ytdl.getBasicInfo(link)
        // console.log(dl.videoDetails.title);
        // const vid = ytdl(link);
        // vid.on("info",(info)=>{
        //     console.log('Title:',info.videoDetails.title);
        // })
        const info = await ytdl.getInfo(link);
        const title = sanitize(info.videoDetails.title);
        const stream = ytdl.downloadFromInfo(info, { quality: "highestaudio" });

        // console.log(info.formats.map(e=>e.container));
        // let audioFormats = ytdl.filterFormats(info.formats, "audioonly");
        // console.log(
        //     audioFormats.map((e) => {
        //         e.;
        //     })
        // );
        // fs.writeFileSync("./data.json", JSON.stringify(audioFormats, null, "\t"));

        // const stream = ytdl(link,{
        //     quality:"highestaudio"
        // })
        console.log(chalk.greenBright("Title:"), title);
        // const start = new Date();
        const spinner = createSpinner("Starting Download...").start();
        const filename = `./downloads/mp3/${title}.mp3`;
        stream.on("progress", (e, downloaded, total) => {
            spinner.update({
                text: `${this.byteToMB(downloaded)}/${this.byteToMB(total)}MB`,
            });
        });
        stream.on("error", (err) => {
            spinner.error({ text: err.message });
        });
        // .on("end",()=>{
        //     console.log("done");
        // })
        ffmpeg(stream)
            .audioBitrate(128)
            .save(filename)
            .on("error", (err) => {
                spinner.error({ text: err.message });
            })
            .on("end", () => {
                spinner.success({ text: "Downloaded." });
            });
    }
}
// const link = "https://www.youtube.com/watch?v=Yj-jxUpAxmE";
const link = "https://youtu.be/vLZElIYHmAI";
// const link = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const dl = new YTDownload();
dl.downloadAudio(link);
