import { deleteWithAutoRetry, getWithAutoRetry, putWithAutoRetry } from "../apis/requestHelper";
import { withQueueMap } from "./withQueueMap";
import axios, { AxiosRequestConfig } from "axios";

export interface IStorageProvider {
    isValidConnection(): Promise<boolean | undefined>;
    isFileExists(filename: string, ignoreNotFound?: boolean): Promise<boolean>;

    listFilesInFolder(extension?: string): Promise<string[]>;

    readText(filename: string, ignoreNotFound?: boolean): Promise<string | undefined>;
    readBinary(filename: string, ignoreNotFound?: boolean): Promise<Buffer | undefined>;

    writeText(filename: string, contents: string): Promise<void>;
    writeBinary(filename: string, contents: ArrayBuffer): Promise<void>;
    writeImages(data: FormData): Promise<void>;
    exportData(): Promise<any>;

    deleteFile(filename: string, ignoreNotFound?: boolean): Promise<void>;
}

export interface IStorageProviderError {
    code: string;
    message: string;
}

export const serverUrl = process.env.REACT_APP_SERVER_SITE_URL;

/**
 * Storage Provider for local storage
 */
@withQueueMap
export class StorageProvider implements IStorageProvider {
    /**
     * Check if the connection is valid
     */
    public async isValidConnection(): Promise<boolean | undefined> {
        try {
            const api = `${serverUrl}`;
            const result = await getWithAutoRetry(api);

            return result.data.success;
        } catch (ex) {
            this.storageErrorHandler(ex);
        }
    }

    /**
     * Read text from specified file
     * @param filename - Name of file in container
     */
    public async readText(filename: string, ignoreNotFound?: boolean): Promise<string | undefined> {
        try {
            const api = `${serverUrl}/files/${filename}`;
            const result = await getWithAutoRetry(api);

            return JSON.stringify(result.data);
        } catch (ex) {
            this.storageErrorHandler(ex, ignoreNotFound);
        }
    }

    /**
     * Read Buffer from specified file
     * @param filename - Name of file in container
     */
    public async readBinary(filename: string, ignoreNotFound?: boolean): Promise<Buffer | undefined> {
        try {
            const api = `${serverUrl}/files/${filename}`;
            const result = await getWithAutoRetry(api);

            return result.data;
        } catch (exception) {
            this.storageErrorHandler(exception, ignoreNotFound);
        }
    }

    /**
     * Write text to file in container
     * @param filename - Name of file in container
     * @param content - Content to write to file (string or Buffer)
     */
    public async writeText(filename: string, content: string) {
        try {
            const api = `${serverUrl}/files/${filename}`;
            await putWithAutoRetry(api, {
                content,
            });
        } catch (exception) {
            this.storageErrorHandler(exception);
        }
    }

    /**
     * Write buffer to file in container
     * @param filename - Name of file in container
     * @param content - Buffer to write to file
     */
    public async writeBinary(filename: string, content: ArrayBuffer) {
        try {
            const api = `${serverUrl}/files/${filename}`;
            await putWithAutoRetry(api, {
                content,
            });
        } catch (exception) {
            this.storageErrorHandler(exception);
        }
    }

    public async exportData() {
        try {
            const api = `${serverUrl}/files/export`;
            const headers = { "Content-Type": "blob" };
            const config: AxiosRequestConfig = { method: "POST", url: api, responseType: "arraybuffer", headers };
            const response = await axios(config);
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", "file.xlsx");
            document.body.appendChild(link);
            link.click();
        } catch (exception) {
            this.storageErrorHandler(exception);
        }
    }

    public async writeImages(formData: FormData) {
        try {
            const api = `${serverUrl}/upload-images`;
            const config = {
                headers: {
                    ...axios.defaults.headers,
                    "Content-Type": "multipart/form-data",
                },
            };
            await axios.post(api, formData, config);
        } catch (exception) {
            this.storageErrorHandler(exception);
        }
    }

    public async export() {
        try {
            const api = `${serverUrl}/export`;
            await axios.post(api);
        } catch (exception) {
            this.storageErrorHandler(exception);
        }
    }

    /**
     * Delete file from container
     * @param filename - Name of file in container
     */
    public async deleteFile(filename: string, ignoreNotFound?: boolean): Promise<void> {
        try {
            const api = `${serverUrl}/files/${filename}`;
            await deleteWithAutoRetry(api);
        } catch (exception) {
            this.storageErrorHandler(exception, ignoreNotFound);
        }
    }

    /**
     * List files in container at specific folder
     * @param path - Folder path containing the files.
     * @param extension - Extension of files to filter on when retrieving files from container
     */
    public async listFilesInFolder(extension?: string): Promise<string[]> {
        let files: string[] = [];
        try {
            const api = `${serverUrl}/files`;
            const result = await getWithAutoRetry(api);
            files = result.data;
        } catch (exception) {
            this.storageErrorHandler(exception);
        }

        return files;
    }

    /**
     * Check file is exists
     * @param filename
     */
    public async isFileExists(filename: string, ignoreNotFound?: boolean): Promise<boolean> {
        try {
            const api = `${serverUrl}/files/${filename}`;
            const result = await getWithAutoRetry(api);
            return result.data !== null;
        } catch (exception) {
            this.storageErrorHandler(exception, ignoreNotFound);
        }

        return false;
    }

    private storageErrorHandler = (exception, ignoreNotFound?: boolean) => {
        if (exception.response?.status === 404 && ignoreNotFound) {
            return;
        }

        const error: IStorageProviderError = {
            code: "Failed to access local files",
            message: "Failed to send request to local server. Please check your server connection.",
        };
        throw error;
    };
}
