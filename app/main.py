from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi import Request, HTTPException
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.routes.api import router

ROOT = Path(__file__).resolve().parent.parent
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI Sana Challenge Hub", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")
app.include_router(router)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def input_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": "Проверьте заполнение и формат полей"}}, status_code=422)


@app.middleware("http")
async def input_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH"):
        if len(await request.body()) > 32 * 1024:
            return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": "Запрос превышает 32 КБ"}}, status_code=413)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    return FileResponse(ROOT / "web" / "index.html")
