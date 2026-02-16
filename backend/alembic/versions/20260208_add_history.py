"""add annotation_history table

Revision ID: 20260208_add_history
Revises: 20260208_add_versions
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260208_add_history"
down_revision = "20260208_add_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "annotation_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "annotation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("annotations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "image_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("images.id"),
            nullable=False,
        ),
        sa.Column("label_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("geometry", postgresql.JSONB, nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("changed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_annotation_history_image_id", "annotation_history", ["image_id"])
    op.create_index("ix_annotation_history_annotation_id", "annotation_history", ["annotation_id"])


def downgrade() -> None:
    op.drop_index("ix_annotation_history_annotation_id", table_name="annotation_history")
    op.drop_index("ix_annotation_history_image_id", table_name="annotation_history")
    op.drop_table("annotation_history")
