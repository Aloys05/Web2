# AloSwift

AloSwift is a supplier/customer marketplace. Suppliers publish products and manage stock; customers save items and contact suppliers directly to agree on an exchange. AloSwift does not collect payments.

## Run locally

1. Install Node.js 22.13 or newer.
2. From this directory, run `npm start`.
3. Open [http://localhost:3000](http://localhost:3000).

The server stores accounts, sessions, products and uploaded images in `data/`. Set `ALOSWIFT_DATA_DIR` to a writable persistent directory before starting the server to store that data elsewhere. Hosting must provide a long-running Node.js server and persistent disk; static-only and ephemeral serverless hosting will not retain marketplace data.

Customers can start an on-site conversation from a product listing without an additional password prompt. Customers and suppliers use the conversation to agree on payment, collection and delivery; AloSwift does not collect payments. Messages are stored as regular text, not end-to-end encrypted. Participants can read their conversation, and the site operator can access messages stored on the server.

## Master admin

Set the admin credentials in the server environment before its first start. In PowerShell:

```powershell
$env:ALOSWIFT_ADMIN_EMAIL = "admin@example.com"
$env:ALOSWIFT_ADMIN_PASSWORD = "a-unique-password-of-at-least-12-characters"
npm start
```

The server creates the admin account once in the database. Keep the email and password private; do not put them in project files or commit them. Later starts can use the existing admin record without these variables. Sign in from the regular login page; the admin dashboard opens in the shop.

Admin tools count distinct browser visitors and daily page views, show registered account profiles and account creation/visit activity, review reports, start support conversations, and apply timed or permanent bans or delete an account. Product listing cards show descriptions and photos; suppliers see distinct visitor counts for their listings. The admin can read support messages in conversations where the admin is a participant, but cannot access customer-supplier conversations. Messages from the previous encrypted-chat version remain stored in their original encrypted form and are identified as legacy messages; they cannot be displayed in regular chat.

The site stores login passwords as salted hashes; neither the admin nor the application can display or recover anyone's existing password. The login-page help link opens an email to the configured admin address so the user can ask for account recovery assistance without sending a password.

Each side can submit one review per customer/supplier pair after a product enquiry has been recorded. Visitor and product-interest metrics use a first-party browser cookie to distinguish returning browsers; deleting that cookie or switching browsers can cause a repeat visitor to be counted again.
