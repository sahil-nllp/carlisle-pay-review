"""Overhaul for four-file upload architecture.

- Drops fy25_award and the 5 hist_* compliance snapshot columns from employees
- Renames fy26_award -> current_award (handled as drop + add since data is being cleared)
- Adds preferred_name, job_classification, service_start_date, hire_date,
  rate_type, hours_per_pay_period to employees
- Widens employees.pp_level from 120 -> 160 chars (Convention strings can be long)
- Drops wage_model_filename / wage_model_path from review_cycles
- Adds 4 file path + timestamp pairs and reference_data_ready to review_cycles
- Creates award_rates, pp_bands, junior_rates tables

Revision ID: 7c4a91f02e10
Revises: 1b8525245472
Create Date: 2026-05-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "7c4a91f02e10"
down_revision: Union[str, Sequence[str], None] = "1b8525245472"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── employees: drop old columns ──────────────────────────────────────────
    op.drop_column("employees", "fy25_award")
    op.drop_column("employees", "fy26_award")
    op.drop_column("employees", "hist_award_level_changed")
    op.drop_column("employees", "hist_rate_changed")
    op.drop_column("employees", "hist_above_award_rate")
    op.drop_column("employees", "hist_above_pp_rate")
    op.drop_column("employees", "hist_above_pp_max")

    # ── employees: add new columns ───────────────────────────────────────────
    op.add_column(
        "employees",
        sa.Column("preferred_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("service_start_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("hire_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("job_classification", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("rate_type", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("hours_per_pay_period", sa.Numeric(8, 2), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("current_award", sa.String(length=60), nullable=True),
    )

    # widen pp_level to fit longer Convention strings
    op.alter_column(
        "employees",
        "pp_level",
        existing_type=sa.String(length=120),
        type_=sa.String(length=160),
        existing_nullable=True,
    )

    # ── review_cycles: drop old wage_model columns ───────────────────────────
    op.drop_column("review_cycles", "wage_model_filename")
    op.drop_column("review_cycles", "wage_model_path")

    # ── review_cycles: add 4 file path + timestamp pairs ─────────────────────
    op.add_column(
        "review_cycles",
        sa.Column("employee_file_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "review_cycles",
        sa.Column(
            "employee_file_uploaded_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "review_cycles",
        sa.Column("award_summary_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "review_cycles",
        sa.Column(
            "award_summary_uploaded_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "review_cycles",
        sa.Column("pp_admin_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "review_cycles",
        sa.Column(
            "pp_admin_uploaded_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "review_cycles",
        sa.Column("pp_tech_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "review_cycles",
        sa.Column(
            "pp_tech_uploaded_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "review_cycles",
        sa.Column(
            "reference_data_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ── new tables: award_rates ──────────────────────────────────────────────
    op.create_table(
        "award_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "cycle_id",
            sa.Integer(),
            sa.ForeignKey("review_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("award_level", sa.String(length=80), nullable=False),
        sa.Column("weekly_rate", sa.Numeric(10, 4), nullable=True),
        sa.Column("laundry", sa.Numeric(8, 4), nullable=True),
        sa.Column("combined_weekly", sa.Numeric(10, 4), nullable=True),
        sa.Column("hourly_rate", sa.Numeric(10, 4), nullable=True),
        sa.Column("laundry_hourly", sa.Numeric(8, 4), nullable=True),
        sa.Column("combined_hourly", sa.Numeric(10, 4), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("section_header", sa.String(length=120), nullable=True),
        sa.Column(
            "is_off_award",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "cycle_id", "award_level", name="uq_award_rate_cycle_level"
        ),
    )
    op.create_index(
        "ix_award_rates_cycle_id", "award_rates", ["cycle_id"]
    )

    # ── new tables: pp_bands ─────────────────────────────────────────────────
    op.create_table(
        "pp_bands",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "cycle_id",
            sa.Integer(),
            sa.ForeignKey("review_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("convention", sa.String(length=160), nullable=False),
        sa.Column("award_key", sa.String(length=60), nullable=True),
        sa.Column("carlisle_label", sa.String(length=160), nullable=True),
        sa.Column("stream", sa.String(length=10), nullable=False),
        sa.Column("section_header", sa.String(length=120), nullable=True),
        sa.Column("award_level_group", sa.String(length=40), nullable=True),
        sa.Column("band_min", sa.Numeric(10, 4), nullable=True),
        sa.Column("band_max", sa.Numeric(10, 4), nullable=True),
        sa.Column("experience_notes", sa.Text(), nullable=True),
        sa.Column("progression_notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "cycle_id", "convention", name="uq_pp_band_cycle_convention"
        ),
    )
    op.create_index("ix_pp_bands_cycle_id", "pp_bands", ["cycle_id"])

    # ── new tables: junior_rates ─────────────────────────────────────────────
    op.create_table(
        "junior_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "cycle_id",
            sa.Integer(),
            sa.ForeignKey("review_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("multiplier", sa.Numeric(5, 4), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("cycle_id", "age", name="uq_junior_rate_cycle_age"),
    )
    op.create_index(
        "ix_junior_rates_cycle_id", "junior_rates", ["cycle_id"]
    )


def downgrade() -> None:
    # Drop new tables
    op.drop_index("ix_junior_rates_cycle_id", table_name="junior_rates")
    op.drop_table("junior_rates")
    op.drop_index("ix_pp_bands_cycle_id", table_name="pp_bands")
    op.drop_table("pp_bands")
    op.drop_index("ix_award_rates_cycle_id", table_name="award_rates")
    op.drop_table("award_rates")

    # review_cycles: restore wage_model columns, drop new ones
    op.drop_column("review_cycles", "reference_data_ready")
    op.drop_column("review_cycles", "pp_tech_uploaded_at")
    op.drop_column("review_cycles", "pp_tech_path")
    op.drop_column("review_cycles", "pp_admin_uploaded_at")
    op.drop_column("review_cycles", "pp_admin_path")
    op.drop_column("review_cycles", "award_summary_uploaded_at")
    op.drop_column("review_cycles", "award_summary_path")
    op.drop_column("review_cycles", "employee_file_uploaded_at")
    op.drop_column("review_cycles", "employee_file_path")
    op.add_column(
        "review_cycles",
        sa.Column("wage_model_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "review_cycles",
        sa.Column("wage_model_filename", sa.String(length=255), nullable=True),
    )

    # employees: narrow pp_level back
    op.alter_column(
        "employees",
        "pp_level",
        existing_type=sa.String(length=160),
        type_=sa.String(length=120),
        existing_nullable=True,
    )

    # employees: drop new columns
    op.drop_column("employees", "current_award")
    op.drop_column("employees", "hours_per_pay_period")
    op.drop_column("employees", "rate_type")
    op.drop_column("employees", "job_classification")
    op.drop_column("employees", "hire_date")
    op.drop_column("employees", "service_start_date")
    op.drop_column("employees", "preferred_name")

    # employees: restore old columns
    op.add_column(
        "employees",
        sa.Column("hist_above_pp_max", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("hist_above_pp_rate", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("hist_above_award_rate", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("hist_rate_changed", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("hist_award_level_changed", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("fy26_award", sa.String(length=60), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("fy25_award", sa.String(length=60), nullable=True),
    )
