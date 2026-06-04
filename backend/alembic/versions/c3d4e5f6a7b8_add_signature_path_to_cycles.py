"""Add signature_path to review_cycles.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_cycles",
        sa.Column("signature_path", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_cycles", "signature_path")
