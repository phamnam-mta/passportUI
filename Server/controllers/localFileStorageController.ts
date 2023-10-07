import { Request, Response, NextFunction } from "express";
import catchAsyncError from "../middlewares/catchAsyncError";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { Image } from "image-js";
import { zipFolder } from "../utils/zipFolder"
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

async function saveOCRLabel(boxes: any, cropImage: any, orgImage: any, ocr: any, scores: any, fileName: any) {
    let boundingBoxes = []
    if (cropImage) {
        const x1 = cropImage.position[0] / orgImage.width;
        const x2 = (cropImage.position[0] + cropImage.width) / orgImage.width;
        const y1 = cropImage.position[1] / orgImage.height;
        const y2 = (cropImage.position[1] + cropImage.height) / orgImage.height;
        boundingBoxes = [ [x1, y1, x2, y1, x2, y2, x1, y2] ]
    } else {
        const line1 = boxes[0]
        const line2 = boxes[1]
        const x1 = line1[0][0] / orgImage.width;
        const y1 = line1[0][1] / orgImage.height;
        const x2 = line1[1][0] / orgImage.width;
        const y2 = line1[1][1] / orgImage.height;
        const x3 = line2[2][0] / orgImage.width;
        const y3 = line2[2][1] / orgImage.height;
        const x4 = line2[3][0] / orgImage.width;
        const y4 = line2[3][1] / orgImage.height;
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
                        "scores": scores,
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
            // const formData = new FormData();
            // formData.append('file', fs.createReadStream(imagePath));

            // const angleApi = `${aiUrl}/api/v1/angle`;
            // try {
            //     const resp = await axios.post(angleApi, formData, {
            //         headers: formData.getHeaders()
            //     });
            //     const imgBuffer = await sharp(imagePath).rotate(resp.data.angle).toBuffer();
            //     await fs.writeFile(imagePath, imgBuffer)
            //     console.log(`rotate: ${resp.data.angle}`);
            //   } catch (error) {
            //     console.error(error);
            // }
            // console.time(imagePath);
            console.time(imagePath);
            try {
                const orgImage = await Image.load(imagePath);
                try {
                    const ocrApi = `${aiUrl}/api/v1/text`;
                    const formData2 = new FormData();
                    formData2.append('file', fs.createReadStream(imagePath));
                    const resp = await axios.post(ocrApi, formData2, {
                        headers: formData2.getHeaders()
                    });
                    const { mrz_text, boxes, scores} = resp.data;
                    await saveOCRLabel(boxes, null , orgImage, mrz_text, scores, file.filename);
                }
                catch {
                    const ocrApiCrop = `${aiUrl}/api/v1/text-by-crop`;
                    const retryResult = { crop: null};
                    getMrz(orgImage, {
                        debug: false,
                        out: retryResult
                    });
                    const cropPath = await saveImages(imagePath, retryResult, dataLocation);
                    const formData2 = new FormData();
                    formData2.append('file', fs.createReadStream(cropPath));
                    const resp = await axios.post(ocrApiCrop, formData2, {
                        headers: formData2.getHeaders()
                    });
                    const { mrz_text, boxes, scores} = resp.data;
                    await saveOCRLabel(boxes, null , orgImage, mrz_text, scores, file.filename);
                }
              } catch (error) {
                await fs.ensureDir(`${dataLocation}/result`);
                fs.copyFile(file.path, `${dataLocation}/result/${file.filename}`, (err: any) => {
                    if (err) {
                        console.log(err)
                    } else {
                      console.log('File has been moved to another folder.')
                    }
                  })
                console.error(error);
                continue;
            }
            console.timeEnd(imagePath);
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
        filename: filename,
        useStyles: true
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
        return null;
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
        await fs.ensureDir(`${dataLocation}/result`)
        const fileLabels = fromDir(dataLocation, ".labels.json")
        												
        const columns = [
            "STT",
            "Họ",
            "Tên",
            "Ngày sinh",
            "Nơi sinh",
            "Giới tính",
            "Quốc tịch",
            "Tôn giáo",
            "Số CMT tại TQ",
            "Email",
            "Giá trị thị thực",
            "Số điện thoại tại Trung Quốc",
            "Loại HC",
            "Số HC",
            "Nơi cấp",
            "Ngày cấp",
            "Ngày hết hạn",
            "Địa chỉ thường trú",
            "Địa chỉ liên lạc tại TQ",
            "Họ tên Người liên lạc khẩn cấp",
            "Số điện thoại liên lạc khẩn cấp",
            "Nghề nghiệp",
            "Tên Cty/CQ/TH",
            "Chức vụ/KH",
            "Địa chỉ",
            "Điện thoại",
            "Mục đích nhập cảnh",
            "Cơ quan, tổ chức",
            "Địa chỉ 2",
            "Điện thoại 2",
            "Mục đích",
            "Số ngày tạm trú ở Việt Nam",
            "Ngày nhập cảnh",
            "Cửa khẩu nhập cảnh",
            "Cửa khẩu xuất cảnh",
          ]
        const sheetName = "INF_NHAN_SU";
        const exportFile = `${dataLocation}/result/ocr_result.xlsx`;
        const workbook = await createReportTemplate(
            exportFile,
            columns,
            sheetName
        );
        const worksheet = workbook.getWorksheet(sheetName);
        let filename = ""
        let count = 0
        fileLabels.forEach(async (_path) => {
            try {
                const rawData = fs.readFileSync(_path);
                const labels = JSON.parse(rawData);
                filename = labels.document
                let ocrized = labels.labels[0]?.value[0]?.ocr || null;
                if (ocrized) {
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
                    const state = parsed.fields.nationality == "TWN" ? "TWN" : parsed.fields.nationality == "CHN" ? "CHN" : "-";
                    // let personName = "-";
                    // if (parsed.fields.lastName && parsed.fields.firstName) {
                    //     personName = parsed.fields.lastName + " " + parsed.fields.firstName;
                    //     personName = personName.replace("0", "O");
                    // }
                    const sex = parsed.fields.sex == "male" ? "Nam" : parsed.fields.sex == "female" ? "Nữ" : "-";
                    const ppID =  parsed.fields.documentNumber ? parsed.fields.documentNumber : "-";

                    const birthDate = formatDate(parsed.fields.birthDate)
                    const expiredDate = formatDate(parsed.fields.expirationDate)
                    
                    count += 1
                    const record = {
                        "STT": count,
                        // "File": filename,
                        "Họ": parsed.fields.lastName? parsed.fields.lastName.replace("0", "O") : "-",
                        "Tên": parsed.fields.firstName? parsed.fields.firstName.replace("0", "O") : "-",
                        "Ngày sinh": birthDate? birthDate : "-",
                        "Nơi sinh": "",
                        "Giới tính": sex,
                        "Quốc tịch": state,
                        "Tôn giáo": "",
                        "Số CMT tại TQ": "",
                        "Email": "",
                        "Giá trị thị thực": "",
                        "Số điện thoại tại Trung Quốc": "",
                        "Loại HC": "",
                        "Số HC": ppID,
                        "Nơi cấp": "",
                        "Ngày cấp": "",
                        "Ngày hết hạn": expiredDate,
                        "Địa chỉ thường trú": "",
                        "Địa chỉ liên lạc tại TQ": "",
                        "Họ tên Người liên lạc khẩn cấp": "",
                        "Số điện thoại liên lạc khẩn cấp": "",
                        "Nghề nghiệp": "",
                        "Tên Cty/CQ/TH": "",
                        "Chức vụ/KH": "",
                        "Địa chỉ": "",
                        "Điện thoại": "",
                        "Mục đích nhập cảnh": "",
                        "Cơ quan, tổ chức": "",
                        "Địa chỉ 2": "",
                        "Điện thoại 2": "",
                        "Mục đích": "",
                        "Số ngày tạm trú ở Việt Nam": "",
                        "Ngày nhập cảnh": "",
                        "Cửa khẩu nhập cảnh": "",
                        "Cửa khẩu xuất cảnh": ""
                        // "Họ và tên (*)": personName,
                        // "Ngày, tháng, năm sinh (*)": birthDate,
                        // "Giới tính (*)": sex,
                        // "Quốc tịch hiện nay (*)": state,
                        // "Quốc tịch gốc": state,
                        // "Nghề nghiệp (*)": "",
                        // "Nơi làm việc": "",
                        // "Số hộ chiếu (*)": ppID,
                        // "Loại hộ chiếu (*)": "",
                        // "Mục đích nhập cảnh (*)": "",
                        // "Đề nghị từ ngày (*)": "",
                        // "Đến ngày (*)": "",
                        // "Giá trị thị thực (*)": "",
                        // "Nơi nhận thị thực (*)": "",
                    }
                    const row = [
                        ...Object.values(record).map((value) => value)
                    ]
                    const rowExcel = worksheet.addRow(row);
                    rowExcel.eachCell(cell => {
                        if (padding > 0) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFFFFF00' } ,
                              };
                        } else {
                            if (cell.value === "-") {
                                cell.fill = {
                                  type: 'pattern',
                                  pattern: 'solid',
                                  fgColor: { argb: 'FFFF0000' } ,// Red color
                                };
                            }
                            if (parseInt(cell.col) === 14 && ["0", "O"].includes(cell.value ? cell.value.toString().charAt(1) : "")) {
                                cell.fill = {
                                    type: 'pattern',
                                    pattern: 'solid',
                                    fgColor: { argb: 'FFFFFF00' } ,
                                  };
                            }
                        }
                      });
                    rowExcel.commit();

                }
                // console.log(parsed);
              } catch (e) {
                fs.copyFile(`${dataLocation}/${filename}`, `${dataLocation}/result/${filename}`, (err: any) => {
                    if (err) {
                        console.log(err)
                    } else {
                      console.log('File has been moved to another folder.')
                    }
                  })
                console.log(e);
                // const row = [...(new Array(columns.length - 1).fill(null))]
                // row[0] = count;
                // row[1] = filename;
                // worksheet.addRow(row).commit();
            }
        })
        await workbook.commit();

        const zipResult = await zipFolder(`${dataLocation}/result`, `${dataLocation}/result.zip`)
        
        setTimeout(() => {
            removeDirectory(dataLocation);
        }, 10 * 1000);
        const absolutePath = path.resolve(`${dataLocation}/result.zip`);
        // Check if the file exists
        if (!fs.existsSync(absolutePath)) {
            return res.status(404).send('File not found');
        }

        // Set the headers for the response
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=download.zip');
        console.log(absolutePath);
        // Read the file and stream it to the response
        const fileStream = fs.createReadStream(absolutePath);
        fileStream.pipe(res);
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
