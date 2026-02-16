from fastapi import APIRouter

from app.api.routes import annotation_jobs, auth, dataset_versions, export, images, imports, insights, jobs, labels, models, projects, tags

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(images.router)
api_router.include_router(projects.router)
api_router.include_router(labels.router)
api_router.include_router(jobs.router)
api_router.include_router(export.router)
api_router.include_router(dataset_versions.router)
api_router.include_router(models.router)
api_router.include_router(imports.router)
api_router.include_router(tags.router)
api_router.include_router(annotation_jobs.router)
api_router.include_router(insights.router)


@api_router.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}
