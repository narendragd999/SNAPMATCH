import os
import sys
from pathlib import Path
from logging.config import fileConfig
from sqlalchemy import create_engine, pool
from alembic import context

def _add_project_root_to_path() -> None:
    """Ensure Alembic can import `app.*` both in Docker and local checkouts."""
    current_file = Path(__file__).resolve()

    for parent in [current_file.parent, *current_file.parents]:
        if (parent / "app").is_dir():
            parent_str = str(parent)
            if parent_str not in sys.path:
                sys.path.insert(0, parent_str)
            return

    # Docker fallback
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")


_add_project_root_to_path()

from app.database.db import Base
from app.models.user           import User
from app.models.event          import Event
from app.models.cluster        import Cluster
from app.models.pricing_config import PricingConfig  # noqa: F401 — required for autogenerate

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:admin123@postgres:5432/event_ai")

target_metadata = Base.metadata

def run_migrations_offline():
    context.configure(url=DATABASE_URL, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = create_engine(DATABASE_URL, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()