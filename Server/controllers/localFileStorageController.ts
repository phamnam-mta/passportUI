import { Request, Response, NextFunction } from "express";
import catchAsyncError from "../middlewares/catchAsyncError";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { Image } from "image-js";
import path from "path";
import axios from "axios";
import * as Excel from 'exceljs';

import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const sharp = require('sharp');
const fs = require('fs-extra');
const FormData = require('form-data');
const { getMrz, readMrz, parse } = require('mrz-detection')

const dataLocation = "Server/data";
export const aiUrl = process.env.AI_SITE_URL;

// Get file => /files/:fileName
export const getFile = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        await fs.ensureDir(dataLocation);
        const file = await readFile(`${dataLocation}/${req.params.filename}`);
        res.send(file);
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
});

// Get file => /files
export const listFiles = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        await fs.ensureDir(dataLocation);
        const files = await readdir(dataLocation);
        res.send(files);
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
});

// Put file => /files/:fileName
export const uploadFile = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    const { params, body } = req;
    try {
        await fs.ensureDir(dataLocation);
        await writeFile(`${dataLocation}/${params.filename}`, body.content);
        res.status(201).send({
            success: true,
        });
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
});

async function saveImages(imagePath: any, images: any, out: any) {
    let cropPath = ""
    const filename = path.basename(imagePath);
    const ext = path.extname(filename);
    const pngName = filename.replace(ext, '.png');
    for (const prefix in images) {
      const kind = path.join(out, prefix);
      await fs.ensureDir(kind);
      const _path = path.join(kind, pngName)
      await images[prefix].save(_path);
      if (prefix === "crop") {
        cropPath = _path;
      }
    }
    return cropPath;
  }

async function saveOCRLabel(boxes: any, cropImage: any, orgImage: any, ocr: any, fileName: any) {
    let boundingBoxes = []
    if (cropImage) {
        const x1 = cropImage.position[0] / orgImage.width;
        const x2 = (cropImage.position[0] + cropImage.width) / orgImage.width;
        const y1 = cropImage.position[1] / orgImage.height;
        const y2 = (cropImage.position[1] + cropImage.height) / orgImage.height;
        boundingBoxes = [ [x1, y1, x2, y1, x2, y2, x1, y2] ]
    } else {
        const x1 = boxes[0][0] / orgImage.width;
        const y1 = boxes[0][1] / orgImage.height;
        const x2 = boxes[1][0] / orgImage.width;
        const y2 = boxes[1][1] / orgImage.height;
        const x3 = boxes[2][0] / orgImage.width;
        const y3 = boxes[2][1] / orgImage.height;
        const x4 = boxes[3][0] / orgImage.width;
        const y4 = boxes[3][1] / orgImage.height;
        boundingBoxes = [ [x1, y1, x2, y2, x3, y3, x4, y4] ]
    }
    const labels = {
        "$schema": "https://schema.cognitiveservices.azure.com/formrecognizer/2021-03-01/labels.json",
        "document": fileName,
        "labels": [
            {
                "label": "MRZ",
                "value": [
                    {
                        "page": 1,
                        "text": ocr.join(""),
                        "ocr": ocr,
                        "boundingBoxes": boundingBoxes
                    }
                ],
                "labelType": "region"
            }
        ]
    }
    const fieldsJson = JSON.stringify(labels, null, "\t");
    await writeFile(`${dataLocation}/${fileName}.labels.json`, fieldsJson);
}

export const parseImage = async (files: any) => {
    try {
        for (let file of files) {
            console.log(`process ${file.filename}`);
            const imagePath = file.path;
            const formData = new FormData();
            formData.append('file', fs.createReadStream(imagePath));

            const angleApi = `${aiUrl}/api/v1/angle`;
            try {
                const resp = await axios.post(angleApi, formData, {
                    headers: formData.getHeaders()
                });
                const imgBuffer = await sharp(imagePath).rotate(resp.data.angle).toBuffer();
                await fs.writeFile(imagePath, imgBuffer)
                console.log(`rotate: ${resp.data.angle}`);
              } catch (error) {
                console.error(error);
            }
            console.time(imagePath);
            const result = { crop: null};
            const orgImage = await Image.load(imagePath);
            let detectMrzOk = true;
            try {
                getMrz(orgImage, {
                debug: false,
                out: result
              });
            } catch (e) {
              console.error(e);
              detectMrzOk = false;
            }
            console.timeEnd(imagePath);
            let ocrImage = imagePath;
            if (detectMrzOk) {
                ocrImage = await saveImages(imagePath, result, dataLocation);
            }

            const ocrApi = `${aiUrl}/api/v1/text`;
            const formData2 = new FormData();
            formData2.append('file', fs.createReadStream(ocrImage));
            try {
                const resp = await axios.post(ocrApi, formData2, {
                    headers: formData2.getHeaders()
                });
                const { boxes, txts} = resp.data;
                await saveOCRLabel(boxes, result.crop , orgImage, txts, file.filename);
              } catch (error) {
                console.error(error);
                continue;
            }
            // try {
            //     const ocrized = await readMrz(await Image.load(cropPath));
            //     await saveOCRLabel(result.crop, orgImage, ocrized, file.filename);
            //     // console.log(ocrized);
            //     // const parsed = parse(ocrized);
            //     // console.log(parsed);
            //   } catch (e) {
            //     console.log(e);
            //     continue;
            // }
        }
        const fields = {
            "$schema": "https://schema.cognitiveservices.azure.com/formrecognizer/2021-03-01/fields.json",
            "fields": [
                {
                    "fieldKey": "MRZ",
                    "fieldType": "selectionMark",
                    "fieldFormat": "not-specified"
                }
            ],
            "definitions": {}
        }
        const fieldsJson = JSON.stringify(fields, null, "\t");
        await writeFile(`${dataLocation}/fields.json`, fieldsJson);
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
};

function fromDir(startPath: any, filter: any) {

    //console.log('Starting from dir '+startPath+'/');
    if (!fs.existsSync(startPath)) {
        console.log("no dir ", startPath);
        return [];
    }

    let filePaths = [];
    const files = fs.readdirSync(startPath);
    for (var i = 0; i < files.length; i++) {
        var filename = path.join(startPath, files[i]);
        // var stat = fs.lstatSync(filename);
        // if (stat.isDirectory()) {
        //     fromDir(filename, filter); //recurse
        // } else if (filename.endsWith(filter)) {
        //     console.log('-- found: ', filename);
        // };
        if (filename.endsWith(filter)) {
            filePaths.push(filename);
        };
    };
    return filePaths;
};

async function createReportTemplate(
    filename: string,
    columns: string[],
    sheet_name: string,
  ): Promise<Excel.stream.xlsx.WorkbookWriter> {
    let workbook = new Excel.stream.xlsx.WorkbookWriter({
        filename,
      });
    const worksheet = workbook.addWorksheet(sheet_name);

    worksheet.addRow(columns).commit();
    return workbook;
}

function removeDirectory(directory: string) {
    if (fs.existsSync(directory)) {
      const files = fs.readdirSync(directory);
      for (const file of files) {
        const filePath = path.join(directory, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          removeDirectory(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }
      fs.rmdirSync(directory);
    }
  }

function formatDate(inputDate: string) {
    if (!inputDate || isNaN(Number(inputDate))) {
        return inputDate;
    }
    const year = Number(inputDate.slice(0, 2));
    const month = Number(inputDate.slice(2, 4)) - 1; // Month is zero-based
    const day = Number(inputDate.slice(4, 6));
    const twoDigitsCurrentYear = Number(new Date().getFullYear().toString().slice(2, 4));
    let date = new Date();
    if (year <= twoDigitsCurrentYear) {
        date = new Date(2000 + year, month, day);
    }
    else {
        date = new Date(year, month, day);
    }
    return date.toLocaleDateString('en-GB'); // Format as "dd/mm/yyyy"
}


export const exportData = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const fileLabels = fromDir(dataLocation, ".labels.json")
        												
        const columns = [
            "STT",
            // "File",
            "Họ và tên (*)",
            "Ngày, tháng, năm sinh (*)",
            "Giới tính (*)",
            "Quốc tịch hiện nay (*)",
            "Quốc tịch gốc",
            "Nghề nghiệp (*)",
            "Nơi làm việc",
            "Số hộ chiếu (*)",
            "Loại hộ chiếu (*)",
            "Mục đích nhập cảnh (*)",
            "Đề nghị từ ngày (*)",
            "Đến ngày (*)",
            "Giá trị thị thực (*)",
            "Nơi nhận thị thực (*)"
          ]
        const sheetName = "INF_NHAN_SU";
        const exportFile = `${dataLocation}/ocr_result.xlsx`;
        const workbook = await createReportTemplate(
            exportFile,
            columns,
            sheetName
        );
        const worksheet = workbook.getWorksheet(sheetName);
        let filename = ""
        let count = 0
        fileLabels.forEach((_path) => {
            try {
                const rawData = fs.readFileSync(_path);
                const labels = JSON.parse(rawData);
                filename = labels.document
                count += 1
                let ocrized = labels.labels[0]?.value[0]?.ocr || "";
                if (ocrized) {
                    ocrized[0] = ocrized[0].slice(0, 44)
                    ocrized[1] = ocrized[1].slice(0, 44)
                    const padding = Math.abs(ocrized[1].length - ocrized[0].length)
                    if (padding > 0) {
                        if (ocrized[1].length > ocrized[0].length) {
                            const textPadding = '<'.repeat(padding);
                            ocrized[0] += textPadding;
                        }
                        else {
                            const textPadding = '0'.repeat(padding);
                            ocrized[1] += textPadding;
                        }
                    }
                    const parsed = parse(ocrized);
                    const state = parsed.fields.nationality == "TWN" ? "Taiwan" : "China";
                    const record = {
                        "STT": count,
                        // "File": filename,
                        "Họ và tên (*)": parsed.fields.lastName + " " + parsed.fields.firstName,
                        "Ngày, tháng, năm sinh (*)": formatDate(parsed.fields.birthDate),
                        "Giới tính (*)": parsed.fields.sex == "male" ? "Nam" : "Nữ",
                        "Quốc tịch hiện nay (*)": state,
                        "Quốc tịch gốc": state,
                        "Nghề nghiệp (*)": "",
                        "Nơi làm việc": "",
                        "Số hộ chiếu (*)": parsed.fields.documentNumber,
                        "Loại hộ chiếu (*)": "",
                        "Mục đích nhập cảnh (*)": "",
                        "Đề nghị từ ngày (*)": "",
                        "Đến ngày (*)": "",
                        "Giá trị thị thực (*)": "",
                        "Nơi nhận thị thực (*)": "",
                    }
                    const row = [
                        ...Object.values(record).map((value) => value)
                    ]
                    worksheet.addRow(row).commit();

                }
                // console.log(parsed);
              } catch (e) {
                console.log(e);
                const row = [...(new Array(columns.length - 1).fill(null))]
                row[0] = count;
                row[1] = filename;
                worksheet.addRow(row).commit();
            }
        })
        await workbook.commit();
        
        setTimeout(() => {
            removeDirectory(dataLocation);
        }, 10 * 1000);
        const absolutePath = path.resolve(exportFile);
        res.setHeader('Content-disposition', 'attachment; filename=' + 'ocr_result.xlsx');
        res.setHeader('Content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const filestream = fs.createReadStream(absolutePath);
        filestream.pipe(res);
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
});


// Delete file => /files/:fileName
export const deleteFile = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        await unlink(`${dataLocation}/${req.params.filename}`);
        res.status(204).send();
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
});
