"""add annotation_jobs table

Revision ID: 20260210_add_annotation_jobs
Revises: 20260210_cascade_deletes
Create Date: 2026-02-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "20260210_add_annotation_jobs"
down_revision = "20260210_cascade_deletes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "annotation_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assigned_to", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_name", sa.String(255), nullable=True),
        sa.Column("instructions", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.Enum("PENDING", "IN_PROGRESS", "DONE", "REVIEW", name="annotation_job_status", create_constraint=False),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("image_ids", JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_annotation_jobs_project_id", "annotation_jobs", ["project_id"])
    op.create_index("ix_annotation_jobs_assigned_to", "annotation_jobs", ["assigned_to"])
    op.create_index("ix_annotation_jobs_status", "annotation_jobs", ["status"])


def downgrade() -> None:
    op.drop_table("annotation_jobs")
