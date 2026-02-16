"""add tags and image_tags tables

Creates the tags table (per-project named tags with optional color)
and image_tags M2M association table.
"""

revision = "20260210_add_tags"
down_revision = "20260209_celery_task_id"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(7), nullable=True),
    )
    op.create_index("ix_tags_project_id", "tags", ["project_id"])
    op.create_index("uq_tag_project_name", "tags", ["project_id", "name"], unique=True)

    op.create_table(
        "image_tags",
        sa.Column("image_id", UUID(as_uuid=True), sa.ForeignKey("images.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", UUID(as_uuid=True), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_image_tags_tag_id", "image_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_table("image_tags")
    op.drop_table("tags")
