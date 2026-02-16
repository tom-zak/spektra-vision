"""initial schema

Revision ID: 20260208_initial
Revises: 
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.types import UserDefinedType


class LtreeType(UserDefinedType):
    cache_ok = True

    def get_col_spec(self) -> str:
        return "LTREE"

revision = "20260208_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS ltree")

    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("ontology", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "task_type",
            sa.Enum("CLASSIFICATION", "DETECTION", "SEGMENTATION", name="tasktype"),
            nullable=False,
        ),
    )

    op.create_table(
        "labels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("path", LtreeType(), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=True),
    )
    op.create_index("ix_labels_path", "labels", ["path"], postgresql_using="gist")

    op.create_table(
        "images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("meta", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "status",
            sa.Enum("NEW", "IN_PROGRESS", "DONE", name="imagestatus"),
            nullable=False,
            server_default="NEW",
        ),
    )

    op.create_table(
        "annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("image_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("images.id"), nullable=False),
        sa.Column("label_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("labels.id"), nullable=False),
        sa.Column("geometry", postgresql.JSONB, nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
    )

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "status",
            sa.Enum("PENDING", "RUNNING", "COMPLETED", "FAILED", name="jobstatus"),
            nullable=False,
        ),
        sa.Column("logs_channel", sa.String(length=255), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("annotations")
    op.drop_table("images")
    op.drop_index("ix_labels_path", table_name="labels")
    op.drop_table("labels")
    op.drop_table("projects")
    op.execute("DROP TYPE IF EXISTS jobstatus")
    op.execute("DROP TYPE IF EXISTS imagestatus")
    op.execute("DROP TYPE IF EXISTS tasktype")
