export interface StoredFile {
  id: number;
  filename: string;
  size: number;
  sha256: string;
  content_type: string | null;
  uploaded_at: string;
}
export interface UploadResult extends Omit<StoredFile, "id"> {
  status: "uploaded";
}

export interface DeleteResult {
  id: number;
  status: "deleted";
  cleanup_pending: boolean;
}
