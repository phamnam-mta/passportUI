import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import routesIndex from "./routes";
import localFileStorage from "./routes/localFileStorage";
import errorMiddleware from "./middlewares/errors";
import cors from "cors";
import multer from "multer";
import { parseImage } from "./controllers/localFileStorageController";
import catchAsyncError from "./middlewares/catchAsyncError";
const fs = require('fs-extra');

const app = express();

dotenv.config({ path: ".env" });

const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
      await fs.ensureDir("/home/Mac_namph/passportUI/data");
      cb(null,  "/home/Mac_namph/passportUI/data");
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname);
    },
  });
const upload = multer({ storage: storage });

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use("/", routesIndex);
app.use("/api/files", localFileStorage);
app.post('/api/upload-images', upload.array("files", 30), catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
    try {
        await parseImage(req.files);
        res.sendStatus(200);
    } catch (err: any) {
        err.statusCode = 404;
        throw err;
    }
}));
app.post('/api/upload-image', upload.single("file"), catchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
  try {
      await parseImage([req.file]);
      res.sendStatus(200);
  } catch (err: any) {
      err.statusCode = 404;
      throw err;
  }
}));

// Middleware to handle errors
app.use(errorMiddleware);

export default app;
