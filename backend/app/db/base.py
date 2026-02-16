from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


from app.models import annotation, annotation_history, annotation_job, image, job, label, project, tag, user  # noqa: E402,F401
