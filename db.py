import sqlite3

from config import DB_PATH

# Одно соединение на всё время работы бота
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA foreign_keys = ON")


def init_db():
    """Создаёт таблицы, если их ещё нет."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sections (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS ideas (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
            text       TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'new',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            done_at    TEXT
        );
        """
    )
    conn.commit()


# ---------- Разделы ----------

def list_sections():
    """Все разделы + число активных идей (не Done) в каждом."""
    return conn.execute(
        """
        SELECT s.id, s.name,
               COUNT(i.id) FILTER (WHERE i.status != 'done') AS active
        FROM sections s
        LEFT JOIN ideas i ON i.section_id = s.id
        GROUP BY s.id
        ORDER BY s.id
        """
    ).fetchall()
