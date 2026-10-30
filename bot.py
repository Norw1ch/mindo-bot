import asyncio
import logging

from aiogram import BaseMiddleware, Bot, Dispatcher, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)

from config import BOT_TOKEN, OWNER_ID, WEBAPP_URL

router = Router()


class OwnerOnlyMiddleware(BaseMiddleware):
    """Пропускает только владельца, остальных молча игнорирует."""

    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        if user is None or user.id != OWNER_ID:
            return
        return await handler(event, data)


@router.message(CommandStart())
async def cmd_start(message: Message):
    if not WEBAPP_URL:
        await message.answer("Адрес приложения не задан: заполни WEBAPP_URL в .env.")
        return
    kb = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Открыть журнал", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await message.answer("<b>Журнал идей</b>", reply_markup=kb)


async def setup_menu_button(bot: Bot):
    """Кнопка «Журнал» слева от поля ввода — только в чате владельца."""
    if not WEBAPP_URL:
        return
    try:
        await bot.set_chat_menu_button(
            chat_id=OWNER_ID,
            menu_button=MenuButtonWebApp(text="Журнал", web_app=WebAppInfo(url=WEBAPP_URL)),
        )
    except Exception as e:
        logging.warning("Не удалось поставить кнопку меню: %s", e)


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.update.outer_middleware(OwnerOnlyMiddleware())
    dp.include_router(router)

    await setup_menu_button(bot)
    # Пропускаем сообщения, пришедшие пока бот был выключен
    await bot.delete_webhook(drop_pending_updates=True)
    logging.info("Бот запущен. Остановить: Ctrl+C")
    await dp.start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот остановлен")
