"""add ON DELETE CASCADE to project FK constraints

Revision ID: cascade_deletes
Revises: add_tags
Create Date: 2026-02-10
"""
from alembic import op

# revision identifiers
revision = "20260210_cascade_deletes"
down_revision = "20260210_add_job_logs"
branch_labels = None
depends_on = None

# (table, constraint_name, column, referred_table)
_FK_SPECS = [
    ("images", "images_project_id_fkey", "project_id", "projects"),
    ("labels", "labels_project_id_fkey", "project_id", "projects"),
    ("tags", "tags_project_id_fkey", "project_id", "projects"),
    ("jobs", "jobs_project_id_fkey", "project_id", "projects"),
    ("dataset_versions", "dataset_versions_project_id_fkey", "project_id", "projects"),
    ("annotations", "annotations_image_id_fkey", "image_id", "images"),
    ("annotations", "annotations_label_id_fkey", "label_id", "labels"),
    ("annotation_history", "annotation_history_image_id_fkey", "image_id", "images"),
]


def upgrade() -> None:
    for table, constraint, column, referred in _FK_SPECS:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(constraint, table, referred, [column], ["id"], ondelete="CASCADE")


def downgrade() -> None:
    for table, constraint, column, referred in _FK_SPECS:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(constraint, table, referred, [column], ["id"])
