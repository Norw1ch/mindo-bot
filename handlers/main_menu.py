from aiogram import F, Router
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from screens import MenuCb, edit_screen, main_screen, safe_delete

router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    """Присылает свежий главный экран, старый удаляет."""
    data = await state.get_data()
    await state.clear()
    await safe_delete(message.bot, message.chat.id, data.get("screen_id"))
    await safe_delete(message.bot, message.chat.id, message.message_id)

    text, kb = main_screen()
    sent = await message.answer(text, reply_markup=kb)
    await state.update_data(screen_id=sent.message_id)


@router.callback_query(MenuCb.filter(F.action == "main"))
async def show_main(cb: CallbackQuery, state: FSMContext):
    await state.set_state(None)
    text, kb = main_screen()
    await edit_screen(cb.bot, cb.message.chat.id, cb.message.message_id, text, kb)
    await cb.answer()


@router.callback_query()
async def not_ready(cb: CallbackQuery):
    # Заглушка: эти кнопки появятся на следующих этапах
    await cb.answer("Будет на следующем этапе")
