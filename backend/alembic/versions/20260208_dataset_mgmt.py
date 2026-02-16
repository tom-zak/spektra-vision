"""Add dataset management, split, null, training metrics

Adds:
- dataset_versions table
- images.split column (TRAIN/VALID/TEST/UNASSIGNED)
- images.is_null column
- jobs.dataset_version_id column
- jobs.metrics column
- jobs.checkpoint column
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260208_dataset_mgmt"
down_revision = "20260208_add_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create image_split enum (needed before add_column)
    op.execute(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_split') THEN "
        "CREATE TYPE image_split AS ENUM ('UNASSIGNED', 'TRAIN', 'VALID', 'TEST'); "
        "END IF; END $$"
    )

    # Note: versionstatus enum is created automatically by op.create_table below

    # Add split and is_null columns to images
    op.add_column(
        "images",
        sa.Column(
            "split",
            sa.Enum("UNASSIGNED", "TRAIN", "VALID", "TEST", name="image_split", create_type=False),
            server_default="UNASSIGNED",
            nullable=False,
        ),
    )
    op.add_column(
        "images",
        sa.Column("is_null", sa.Boolean(), server_default="false", nullable=False),
    )

    # Add new columns to jobs (dataset_version_id FK added after table creation)
    op.add_column(
        "jobs",
        sa.Column("dataset_version_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "jobs",
        sa.Column("metrics", JSONB, nullable=True, server_default="{}"),
    )
    op.add_column(
        "jobs",
        sa.Column("checkpoint", sa.String(1024), nullable=True),
    )

    # Create dataset_versions table
    op.create_table(
        "dataset_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column(
            "status",
            sa.Enum("GENERATING", "READY", "FAILED", name="versionstatus", create_type=False),
            server_default="GENERATING",
            nullable=False,
        ),
        sa.Column("train_pct", sa.Float(), server_default="0.7", nullable=False),
        sa.Column("valid_pct", sa.Float(), server_default="0.2", nullable=False),
        sa.Column("test_pct", sa.Float(), server_default="0.1", nullable=False),
        sa.Column("preprocessing", JSONB, server_default="{}", nullable=True),
        sa.Column("augmentation", JSONB, server_default="{}", nullable=True),
        sa.Column("num_images", sa.Integer(), server_default="0"),
        sa.Column("num_train", sa.Integer(), server_default="0"),
        sa.Column("num_valid", sa.Integer(), server_default="0"),
        sa.Column("num_test", sa.Integer(), server_default="0"),
        sa.Column("num_annotations", sa.Integer(), server_default="0"),
        sa.Column("num_classes", sa.Integer(), server_default="0"),
        sa.Column("image_snapshot", JSONB, server_default="[]", nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Now add the FK constraint
    op.create_foreign_key(
        "fk_jobs_dataset_version_id",
        "jobs",
        "dataset_versions",
        ["dataset_version_id"],
        ["id"],
    )

    # Backfill existing data
    op.execute("UPDATE images SET split = 'UNASSIGNED' WHERE split IS NULL")
    op.execute("UPDATE images SET is_null = false WHERE is_null IS NULL")
    op.execute("UPDATE jobs SET metrics = '{}' WHERE metrics IS NULL")


def downgrade() -> None:
    op.drop_constraint("fk_jobs_dataset_version_id", "jobs", type_="foreignkey")
    op.drop_table("dataset_versions")
    op.drop_column("jobs", "checkpoint")
    op.drop_column("jobs", "metrics")
    op.drop_column("jobs", "dataset_version_id")
    op.drop_column("images", "is_null")
    op.drop_column("images", "split")
    op.execute("DROP TYPE IF EXISTS image_split")
    op.execute("DROP TYPE IF EXISTS versionstatus")
