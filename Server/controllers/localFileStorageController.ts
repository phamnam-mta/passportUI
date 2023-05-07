import { Request, Response, NextFunction } from "express";
import catchAsyncError from "../middlewares/catchAsyncError";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { Image } from "image-js";
import path from "path";
import * as Excel from 'exceljs';

const fs = require('fs-extra');
const { getMrz, readMrz, parse } = require('mrz-detection')

const dataLocation = "Server/data";

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

async function saveOCRLabel(cropImage: any, orgImage: any, ocr: any, fileName: any) {
    const x1 = cropImage.position[0] / orgImage.width;
    const x2 = (cropImage.position[0] + cropImage.width) / orgImage.width;
    const y1 = cropImage.position[1] / orgImage.height;
    const y2 = (cropImage.position[1] + cropImage.height) / orgImage.height;
    const boundingBoxes = [ [x1, y1, x2, y1, x2, y2, x1, y2] ]
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
            console.time(imagePath);
            const result = { crop: null};
            const orgImage = await Image.load(imagePath);
            try {
                getMrz(orgImage, {
                debug: false,
                out: result
              });
            } catch (e) {
              console.error(e);
              continue;
            }
            console.timeEnd(imagePath);
            const cropPath = await saveImages(imagePath, result, dataLocation);
            // toSave.push([imagePath, result]);
            try {
                const ocrized = await readMrz(await Image.load(cropPath));
                await saveOCRLabel(result.crop, orgImage, ocrized, file.filename);
                // console.log(ocrized);
                // const parsed = parse(ocrized);
                // console.log(parsed);
              } catch (e) {
                console.log(e);
                continue;
            }
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


export const exportData = catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const fileLabels = fromDir(dataLocation, ".labels.json")
        const columns = [
            "filename",
            "documentCode",
            "issuingState",
            "lastName",
            "firstName",
            "documentNumber",
            "documentNumberCheckDigit",
            "nationality",
            "birthDate",
            "birthDateCheckDigit",
            "sex",
            "expirationDate",
            "expirationDateCheckDigit",
            "personalNumber",
            "personalNumberCheckDigit",
            "compositeCheckDigit",
          ]
        const sheetName = "result";
        const exportFile = `${dataLocation}/ocr_result.xlsx`;
        const workbook = await createReportTemplate(
            exportFile,
            columns,
            sheetName
        );
        const worksheet = workbook.getWorksheet(sheetName);
        let filename = ""
        fileLabels.forEach((_path) => {
            try {
                const rawData = fs.readFileSync(_path);
                const labels = JSON.parse(rawData);
                filename = labels.document
                const ocrized = labels.labels[0]?.value[0]?.ocr || "";
                if (ocrized && ocrized[1].length === 43) {
                    ocrized[1] += "0";
                }
                if (ocrized && ocrized[0].length === 43) {
                    ocrized[1] += "<";
                }
                const parsed = parse(ocrized);
                const row = [
                    filename,
                    ...Object.values(parsed.fields).map((value) => value)
                ]
                worksheet.addRow(row).commit();
                // console.log(parsed);
              } catch (e) {
                console.log(e);
                const row = [filename, ...(new Array(columns.length - 1).fill(null))]
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
