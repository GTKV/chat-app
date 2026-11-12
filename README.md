# Free deploy guide
1. MongoDB Atlas (free M0): cluster banao -> Database Access me user -> Network Access me 0.0.0.0/0 -> Connect se MONGO_URL copy karo
2. Brevo (free): signup -> Senders me apna email verify karo -> SMTP & API -> API key banao (BREVO_KEY, MAIL_FROM = wahi verified email)
3. Metered.ca (free TURN): signup -> TURN credentials copy karke ICE_SERVERS me daalo (optional par video ke liye zaroori)
4. Code GitHub par push karo (.env push NAHI karna)
5. Render.com -> New Web Service -> GitHub repo -> Build: npm install, Start: npm start -> Environment me .env ki saari values daalo, JWT_SECRET random rakho
6. UptimeRobot (free) se site URL ko har 5 min ping karwao
Local test: .env banao, `npm install`, `npm start`
