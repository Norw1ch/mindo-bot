from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters.callback_data import CallbackData
from aiogram.utils.keyboard import InlineKeyboardBuilder
from html import escape

import db


# ---------- Данные кнопок ----------

class MenuCb(CallbackData, prefix="m"):
    action: str  # main / new_section / archive


class SectionCb(CallbackData, prefix="s"):
    action: str  # open
    section_id: int


# ---------- Отрисовка ----------

async def edit_screen(bot: Bot, chat_id: int, message_id: int, text: str, kb):
    """Меняет экранное сообщение. Если ничего не изменилось — молча пропускаем."""
    try:
        await bot.edit_message_text(
            text=text, chat_id=chat_id, message_id=message_id, reply_markup=kb
        )
    except TelegramBadRequest as e:
        if "message is not modified" not in str(e):
            raise


async def safe_delete(bot: Bot, chat_id: int, message_id: int | None):
    """Удаляет сообщение, не падая, если его уже нет."""
    if not message_id:
        return
    try:
        await bot.delete_message(chat_id, message_id)
    except TelegramBadRequest:
        pass


# ---------- Экраны ----------

def main_screen():
    sections = db.list_sections()
    if sections:
        text = "<b>Журнал идей</b>\n\nВыбери раздел."
    else:
        text = "<b>Журнал идей</b>\n\nРазделов пока нет."

    kb = InlineKeyboardBuilder()
    for s in sections:
        kb.button(
            text=f"{escape(s['name'])}  ·  {s['active']}",
            callback_data=SectionCb(action="open", section_id=s["id"]),
        )
    kb.button(text="➕ Новый раздел", callback_data=MenuCb(action="new_section"))
    kb.button(text="🗄 Архив Done", callback_data=MenuCb(action="archive"))
    kb.adjust(1)  # по одной кнопке в ряд
    return text, kb.as_markup()
