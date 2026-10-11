from pathlib import Path

from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse

app = FastAPI()

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok = True)

@app.get("/")
def root():
	return {"message" : "AI Cloud Server is running"}

@app.post("/upload")
async def upload_file(file : UploadFile = File(...)):
	destination = STORAGE_DIR / file.filename

	with destination.open("wb") as output:
		while True:
			chunk = await file.read(1024 * 1024)
			if not chunk:
				break
			output.write(chunk)

	return {
		"filename" : file.filename, 
		"status" : "uploaded"
	}

@app.get("/download/{filename}")
def download_file(filename : str):
	file_path = STORAGE_DIR / filename

	return FileResponse(
		path = file_path,
		filename = filename
	)
