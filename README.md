# Setup
1. Create bot via @BotFather, create private channel, add bot as admin.
2. Upload empty database.json `[]` to channel, get its file_id via @getidsbot or via getUpdates, put in .env as DB_FILE_ID.
3. Deploy to Vercel 3 times (yt-1, yt-2, yt-3) with same env, connect same Telegram channel.
4. Use ?key=ADMIN_KEY for admin.
5. Note: Only use for content you own/have rights to. Piped API is example.