from sqlalchemy import create_engine, Column, Integer, String, DateTime, func
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from pathlib import Path
import os

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{Path(__file__).parent.parent.parent / 'akiscfd.db'}")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    credits = Column(Integer, default=3)          # 3 free simulations on signup
    created_at = Column(DateTime, server_default=func.now())


def create_tables():
    Base.metadata.create_all(bind=engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
