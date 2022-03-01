#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { exec } = require("child_process")

const program = require('commander')
const iconv = require('iconv-lite')

const listDir = (dir, filter) => {
    return fs.readdirSync(dir).filter(el => filter(el))
}

const preventInvalidNameOnWorkDirs = (root, workDirs) => {
    workDirs.forEach(el => {
        let dirName = path.resolve(root, el)
        let files = fs.readdirSync(dirName)

        files.map(elf => {
            if (/[\/:*\?"<>]/.test(elf)){
                let fullName = path.resolve(dirName, elf)
                let newFullName = path.resolve(dirName, elf.replace(/[\/:*\?"<>]/g, ""))
                fs.renameSync(fullName, newFullName)
            }
        })
        
    })    
}

const convertFormat = async (root, workDirs, sourceFormat, targetFormat) => {
    const changeCueEncode = workDir => {
        let paths = listDir(workDir, el => /\.cue$/.test(el))

        if (0 === paths.length) {
            return
        } 

        let cuePath = path.resolve(root, workDir, paths.shift(paths))
        let cueStr = fs.readFileSync(cuePath)
        fs.writeFileSync(cuePath, iconv.decode(cueStr, "gb18030"))
        return cuePath
    }

    const transformAudio = workDir => {
        let paths = listDir(workDir, el => (new RegExp(`\.${sourceFormat}$`)).test(el))

        if (0 === paths.length) {
            return
        }

        let sourcePath = path.resolve(root, workDir, paths.shift(paths))
        let targetFile = path.resolve(root, workDir, "cd.flac")
        let cmd = `ffmpeg -i "${sourcePath}" "${targetFile}"`
        
        return new Promise((resolve) => {
            exec(cmd, (error) => {
                if (!error) {
                    fs.rmSync(sourcePath)
                    resolve(targetFile)
                }
            })
        })
    }

    const splitIntoTrackFile = (root, sourceFile, cuePath) => {
        let cmd = `shnsplit  -d "${root}" -f "${cuePath}" -t "%n %t" -o flac "${sourceFile}"`

        return new Promise((resolve) => {
            exec(cmd, (error) => {
                if (!error) {
                    fs.rmSync(sourceFile)
                    fs.rmSync(cuePath)
                    resolve()
                }
            })
        })
    }

    const change2M4A = root => {
        let paths = listDir(root, el => /flac/.test(el))

        if (0 === paths.length) {
            return
        }

        paths.unshift(null)
    
        return paths.reduce(async (__, curr) => {
            let tar = path.resolve(root, curr.replace(/\.flac$/, '.m4a'))
            let s = path.resolve(root, curr)
            let cmd = `ffmpeg -i "${s}" -acodec alac "${tar}"`

            return await (__ => {
                return new Promise((resolve) => {
                    exec(cmd, (error) => {
                        if (!error) {
                            fs.rmSync(s)
                            resolve()
                        }
                    }) 
                })
            })() 
        })
    }

    const clean = (root, cleanArray) => {
        let paths = listDir(root, el => {
            return cleanArray.some(postfix => el.endsWith(postfix))
        })

        paths.forEach(p => { fs.rmSync(path.resolve(root, p)) })
    }

    workDirs.forEach(async el => {
        let dirName = path.resolve(root, el)
        let cuePath = changeCueEncode(dirName)

        if (!cuePath){
            return
        }

        let tmpFile = await transformAudio(dirName)
        if (!tmpFile) {
            return 
        }

        await splitIntoTrackFile(dirName, tmpFile, cuePath)
        
        let cleanArray = ['.log']

        if (targetFormat === "m4a") {
            await change2M4A(dirName)
            cleanArray.push(".flac")
        }

        // await clean(dirName, cleanArray)
        return 
    })
}

const main = async (opts) => {
    opts = program.opts()
    opts = Object.assign({
        "root": path.resolve("../"),
        "filter": "^CD[0-9A-Za-z]+$",
        "sourceFormat": "flac",
        "targetFormat": "m4a"
    }, opts)

    let filterString = opts.filter

    opts.filter = (el) => {
        return new RegExp(filterString).test(el)
    }

    const { root, filter } = opts
    let workDirs = listDir(root, filter)

    await convertFormat(root, workDirs, opts["sourceFormat"], opts["targetFormat"])
    await preventInvalidNameOnWorkDirs(root, workDirs)
}

program
  .allowUnknownOption()
  .version(require('../package').version)
  .option("-r, --root [value]", "the root dir where you scan workdirs")
  .option("-f, --filter [value]", "the filter regex which test whether the dir is chosen")
  .option("-s, --sourceFormat [value]", "source audio format")
  .option("-t, --targetFormat [value]", "target audio format")
  .parse(process.argv)

~(async _ => {
    await main(program)
})()