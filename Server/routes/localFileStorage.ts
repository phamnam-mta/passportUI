import express from "express";

const router = express.Router();

import { getFile, uploadFile, deleteFile, listFiles, exportData } from "../controllers/localFileStorageController";

router.route("/export").post(exportData);
router.route("/:filename").get(getFile);
router.route("/:filename").put(uploadFile);
router.route("/:filename").delete(deleteFile);
router.route("/").get(listFiles);

export default router;
