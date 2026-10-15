# AloSwift

AloSwift is a supplier/customer marketplace. Suppliers publish products and manage stock; customers save items and contact suppliers directly to agree on an exchange. AloSwift does not collect payments.

## Run locally

1. Install Node.js 22.13 or newer.
2. From this directory, run `npm start`.
3. Open [http://localhost:3000](http://localhost:3000).

The server stores accounts, sessions, products and uploaded images in `data/`. Set `ALOSWIFT_DATA_DIR` to a writable persistent directory before starting the server to store that data elsewhere. Hosting must provide a long-running Node.js server and persistent disk; static-only and ephemeral serverless hosting will not retain marketplace data.

Enquiry buttons prepare an email addressed to the supplier. Sending requires an email application configured on the customer's device.
