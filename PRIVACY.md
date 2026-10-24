# Privacy / Datenschutz

## English

Redeemind stores vouchers, settings, and local display preferences only in the
browser. Vouchers and settings are preferably synchronized through the browser's
`storage.sync`; if sync is unavailable or its quota is reached, Redeemind uses
`storage.local`.

There is no Redeemind server, analytics, tracking, advertising, or network
transfer of user data. The browser may transfer sync data according to the
browser account's settings and privacy terms. Optional local code encryption
uses PBKDF2 and AES-GCM; the master password is never stored and cannot be
recovered. The content script reads only the current HTTP(S) page's domain and
checkout hints and does not send page content anywhere.

## Deutsch

Redeemind speichert Gutscheine, Einstellungen und lokale Anzeigepräferenzen nur
im Browser. Gutscheine und Einstellungen werden bevorzugt über den vom Browser
bereitgestellten `storage.sync` synchronisiert. Bei nicht verfügbarem Sync oder
erreichter Quota verwendet Redeemind `storage.local`.

Es gibt keinen Redeemind-Server, keine Analyse, kein Tracking, keine Werbung und
keine Netzwerkübertragung der Daten. Der Browser kann `storage.sync` gemäß den
eigenen Kontoeinstellungen und Datenschutzbedingungen in das Sync-Konto des
Nutzers übertragen. Dadurch bleiben die Daten entweder lokal oder im Browser-Sync
des Nutzers.

### Sicherheit

Die Daten bleiben im Browser: in `storage.local` oder optional im vom Browser
bereitgestellten `storage.sync`. Redeemind betreibt keine eigenen Server und
verwendet kein Tracking. Die Sicherheit des Browser-Syncs hängt vom jeweiligen
Browser-Konto ab: bei Chrome vom Google-Konto und optional von einer aktivierten
Sync-Passphrase, bei Firefox vom Mozilla-Konto.

Optional können Gutscheincodes lokal mit einem Master-Passwort verschlüsselt
werden. Dafür werden PBKDF2 und AES-GCM verwendet. Das Master-Passwort wird nicht
gespeichert; sein Verlust bedeutet, dass die verschlüsselten Codes nicht
wiederhergestellt werden können. Die Option „Nur lokal“ deaktiviert den
Browser-Sync und hält die Daten ausschließlich im lokalen Browser-Speicher.

Das Content-Script liest die aktuelle HTTP- oder HTTPS-Seite, um die Domain,
Checkout-Hinweise und optionale Gutscheinfeld-Heuristiken zu erkennen. Es sendet
keine Seiteninhalte an Redeemind. Nur die für die Anzeige passenden, bereits
lokal gespeicherten Gutscheine werden in der Erweiterung verwendet.

### Berechtigungen

`storage` speichert Daten, `alarms` plant die Ablaufprüfung, `notifications`
ermöglicht optionale Ablaufhinweise, `contextMenus` fügt das Kontextmenü hinzu,
`clipboardWrite` kopiert einen vom Nutzer angeforderten Code und `activeTab`
unterstützt die Interaktion mit dem aktiven Tab. Der Host-Zugriff ist auf
`http://*/*` und `https://*/*` beschränkt, weil das Content-Script Gutscheine
auf Einkaufsseiten anzeigen muss. Interne Browser-Seiten und andere Protokolle
werden nicht erfasst.
