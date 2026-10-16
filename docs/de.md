# Keenetic

Verfolge deinen **Keenetic**-Router in Gladys Assistant: wer zu Hause ist, den Zustand des Routers,
deine Internetverbindung und ihren 4G-/5G-Ersatz, das Gäste-WLAN. Alles bleibt in deinem lokalen
Netzwerk: Die Integration spricht mit dem Router über RCI, die JSON-Schnittstelle seiner
Weboberfläche, ohne Cloud.

Ohne die Hardware entwickelt: Rückmeldungen sind willkommen, in
[den Issues des Projekts](https://github.com/guim31/gladys-keenetic/issues). Diese Integration ist
nicht mit Keenetic Ltd. verbunden.

## Überblick

- **Anwesenheit**: Jedes gewählte Gerät (ein Handy, ein Laptop, ein NAS am Kabel) wird ein
  Anwesenheitssensor, anwesend, solange der Router es online sieht, im WLAN, am Kabel oder an einem
  Mesh-Verstärker.
- **Router**: CPU-Last, Speicher, Betriebszeit, KeeneticOS-Version, verbundene Geräte und
  WLAN-Clients.
- **Internet**: ob der Router das Internet erreicht, die genutzte Verbindung mit ihrer Download- und
  Upload-Rate und, wenn der Router mehrere Verbindungen hat, ob die Ersatzverbindung (4G-/5G-Modem,
  zweiter Anbieter) aufgebaut ist und genutzt wird.
- **Szenen**: ein unbekanntes Gerät verbunden, Internet ausgefallen und wiederhergestellt, der
  Wechsel auf die Ersatzverbindung und die Rückkehr zur Hauptverbindung.
- **Befehle, standardmäßig aus**: Gäste-WLAN ein und aus, den Internetzugang eines Geräts sperren
  (Kindersicherung), den Router neu starten.
- **Widgets**: der Zustand des Routers und die Geräte zu Hause.

## Voraussetzungen

- Ein Keenetic-Router (Giga, Ultra, Hopper, Viva, Peak, Titan, Hero, Speedster…) mit KeeneticOS 3
  oder neuer. Die Integration wurde für KeeneticOS 4 und 5 geschrieben.
- Gladys Assistant 5.1 oder neuer, im selben lokalen Netzwerk wie der Router.
- Die **lokale** Adresse des Routers (z. B. `192.168.1.1`). Eine KeenDNS-Adresse funktioniert nicht:
  Der Fernzugriff bietet die Anmeldung der lokalen Weboberfläche nicht an.

### Einen eigenen Benutzer anlegen

Gib Gladys nicht das Konto `admin`. Öffne in der Weboberfläche des Routers **Benutzer und Zugriff**
(Users and access, Menü Verwaltung), lege einen Benutzer an, z. B. `gladys`, mit einem starken
Passwort, und aktiviere nur **Weboberfläche** (Web interface: kein CLI, kein FTP, kein VPN).

- **Nur lesen** (empfohlen, wenn du die Befehle nicht nutzt): Füge in der Kommandozeile des Routers
  (Telnet / SSH oder die Web-CLI unter `http://<router>/a`) das Nur-Lese-Tag hinzu:

  ```
  user gladys tag readonly
  system configuration save
  ```

  Anwesenheit, Messwerte und Szenenauslöser funktionieren; der Router lehnt die Befehle ab.

- **Mit den Befehlen**: Lass den Benutzer ohne `readonly` und aktiviere dann **Befehle erlauben** in
  der Konfiguration der Integration.

## Konfiguration

In Gladys: **Integrationen → Keenetic → Konfiguration**.

| Feld                              | Was du einträgst                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Adresse des Routers               | Die lokale IP-Adresse des Routers, mit `:Port`, wenn seine Weboberfläche nicht Port 80 nutzt.                                     |
| Benutzername                      | Der eigene Benutzer, z. B. `gladys`.                                                                                              |
| Passwort                          | Sein Passwort. Es verlässt Gladys nie: Nur eine einmalige Antwort auf die Challenge des Routers wird übertragen.                  |
| Aktualisierungsintervall          | 10 s, 15 s, 30 s (Standard) oder 1 Minute. Die Raten sind Mittelwerte über dieses Intervall.                                      |
| Abwesenheitsverzögerung (Minuten) | Ein nicht mehr gesehenes Gerät gilt nach dieser Verzögerung als abwesend (standardmäßig 5 Minuten, 0 bis 60).                     |
| Gästesegment                      | Leer (Standard): das Gästenetz des Routers, automatisch gefunden. Sonst eine Segment-ID wie `Bridge1`.                            |
| Befehle erlauben                  | Standardmäßig aus. Erlaubt Szenen und dem Widget, das Gäste-WLAN zu schalten, ein Gerät zu sperren und den Router neu zu starten. |
| Sprache der Namen                 | Die Sprache der Geräte- und Funktionsnamen, festgelegt beim Hinzufügen eines Geräts (standardmäßig Französisch).                  |

Klicke dann auf **Verbindung testen**: Der Bericht nennt das Modell, die KeeneticOS-Version, die
Internetverbindungen nach Priorität, die Segmente mit ihrer ID, den Zustand des Gäste-WLANs und was
der Benutzer nicht lesen darf.

## Geräte

Öffne den Tab **Entdecken** der Integration: Zuerst kommt der Router, dann die Geräte seiner
Host-Tabelle (die registrierten zuerst). Füge die hinzu, die du verfolgen willst.

### Der Router

| Funktion                    | Werte                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| CPU-Last                    | % des Prozessors.                                                                                       |
| Belegter Speicher           | %, so wie die Weboberfläche ihn zählt.                                                                  |
| Betriebszeit                | Stunden seit dem letzten Start.                                                                         |
| KeeneticOS-Version          | z. B. `4.1.7`.                                                                                          |
| Internet verfügbar          | 1, wenn der Router das Internet erreicht, sonst 0.                                                      |
| Genutzte Verbindung         | Der Name der Verbindung, die das Internet trägt (ihre Beschreibung im Router), Keine bei einem Ausfall. |
| Download-Rate               | Mbit/s auf der genutzten Verbindung, gemittelt über das Aktualisierungsintervall.                       |
| Upload-Rate                 | Mbit/s auf der genutzten Verbindung.                                                                    |
| Ersatzverbindung in Nutzung | 1, wenn das Internet über eine Ersatzverbindung läuft (nur mit mehreren Verbindungen).                  |
| Ersatzverbindung aufgebaut  | 1, wenn die erste Ersatzverbindung aufgebaut ist, bereit zur Übernahme.                                 |
| WLAN-Clients                | Stationen im WLAN des Routers selbst (nicht an den Mesh-Verstärkern).                                   |
| Verbundene Geräte           | Geräte, die der Router online sieht.                                                                    |
| Gäste-WLAN aktiviert        | 1, wenn das WLAN des Gästesegments an ist (nur mit einem Gästesegment).                                 |

Die Internetverbindungen sind die Schnittstellen, die der Router für das Internet nutzt, nach ihrer
Priorität unter **Internet → Verbindungsprioritäten** (Connection priorities). Ein für das Internet
genutzter VPN-Tunnel (WireGuard, OpenVPN, IPsec…) ist keine eigene Internetverbindung und kein
Ersatz.

Nichts ist ein Schalter: Der Zustand des Gäste-WLANs ist nur lesbar, damit ein Sprachassistent oder
ein versehentlicher Tipp im Dashboard nie ein Netz abschaltet. Die Befehle laufen über die
Szenenaktionen und das Widget.

### Netzwerkgeräte (Anwesenheit)

Jedes hinzugefügte Gerät ist ein Sensor für **Anwesenheit**: 1 anwesend, 0 abwesend. Es ist
anwesend, solange der Router es online sieht (das „Online“ seiner Geräteliste) oder solange es mit
einem Access Point des Routers verbunden ist. Es wird abwesend, sobald die Abwesenheitsverzögerung
seit dem letzten Sehen abgelaufen ist: Ein schlafendes Handy verlässt das WLAN ein paar Minuten, ohne
das Haus zu verlassen. Wenn der Router nicht lesbar ist, wird niemand abwesend gemeldet.

## Widgets

- **Keenetic-Router**: CPU, Speicher, Download- und Upload-Rate, verbundene Geräte; Internet mit der
  genutzten Verbindung, die Ersatzverbindung (bereit, in Nutzung, getrennt), das Gäste-WLAN, die
  Betriebszeit und die Version. Mit **Befehle erlauben** ein Knopf **Gäste-WLAN** (sein Symbol zeigt
  den aktuellen Zustand) und ein Knopf **Neu starten**, beide mit Bestätigung.
- **Geräte zu Hause**: die verfolgten Geräte, anwesende zuerst, mit der Zeit seit dem Verlassen und
  denen, deren Internetzugang gesperrt ist. Die Einstellung zeigt alle oder nur die anwesenden.

## Szenenauslöser

| Auslöser                         | Wann                                                                                | Filter und Variablen                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbekanntes Gerät verbunden      | Eine nie gesehene MAC-Adresse ist online. Die erste Abfrage lernt das Netzwerk.     | Filter: Netzwerk (Heimnetz, Gästenetz, anderes), verbunden über (WLAN, Kabel). Variablen: MAC-Adresse, IP-Adresse, Hostname, WLAN-Netz (SSID). |
| Internet ausgefallen             | Der Router erreicht das Internet über keine Verbindung mehr.                        | Zuletzt genutzte Verbindung.                                                                                                                   |
| Internet wiederhergestellt       | Das Internet ist zurück.                                                            | Verbindung, Dauer des Ausfalls (Minuten).                                                                                                      |
| Wechsel auf die Ersatzverbindung | Die Hauptverbindung ist ausgefallen, das Internet läuft über eine Ersatzverbindung. | Ersatzverbindung, Hauptverbindung.                                                                                                             |
| Zurück auf der Hauptverbindung   | Der Router nutzt wieder seine Hauptverbindung.                                      | Hauptverbindung, Zeit auf dem Ersatz (Minuten).                                                                                                |

Ein Wechsel auf den Ersatz ist kein Internetausfall: „Internet ausgefallen“ löst nur aus, wenn keine
Verbindung funktioniert.

## Szenenaktionen

Alle brauchen **Befehle erlauben** und einen Benutzer ohne `readonly`.

- **Gäste-WLAN einschalten** / **Gäste-WLAN ausschalten**: alle Access Points des Gästesegments (2,4
  und 5 GHz). Ausgabe: Gäste-WLAN aktiviert.
- **Internet eines Geräts sperren** / **Internet eines Geräts erlauben**: Wähle ein Netzwerkgerät,
  das die Integration verfolgt. Der Router kann nur ein in seiner Geräteliste **registriertes** Gerät
  sperren: Registriere es zuerst unter **Gerätelisten** (Device lists) der Weboberfläche des Routers.
  Ausgabe: Internetzugang gesperrt.
- **Keenetic-Router neu starten**: Das Netzwerk ist zwei bis drei Minuten weg.

Jeder Befehl wird beim Router nachgelesen und in seiner Konfiguration gespeichert, damit er einen
Neustart übersteht.

## Konfigurationsaktionen

- **Verbindung testen**: meldet sich neu an und liest alles, dann gibt es den im Abschnitt
  Konfiguration beschriebenen Bericht.

## Szenenbeispiele

- **Gäste**: Wenn der Modus „Gäste“ beginnt, das Gäste-WLAN einschalten; um 23 Uhr ausschalten.
- **Hausaufgaben**: an jedem Schultag um 21 Uhr das Internet des Kinder-Tablets sperren; um 7 Uhr
  wieder erlauben.
- **Störung**: bei „Wechsel auf die Ersatzverbindung“ eine Nachricht „Glasfaser weg, gerade über
  4G“ schicken und die Cloud-Sicherungen des NAS pausieren; bei „Zurück auf der Hauptverbindung“
  fortsetzen.
- **Eindringling**: bei „Unbekanntes Gerät verbunden“ mit dem Filter Netzwerk = Heimnetz eine
  Benachrichtigung mit MAC-Adresse und Hostname schicken.
- **Niemand zu Hause**: Wenn alle verfolgten Handys abwesend sind, die Lichter ausschalten und die
  Alarmanlage mit einer Szene von Gladys scharf schalten.

## Netzwerknutzung

- Eine gebündelte Anfrage an den Router pro Aktualisierungsintervall (Last, Schnittstellen,
  Host-Tabelle, WLAN-Verbindungen, Internetstatus und die Zähler der Verbindungen), auf seiner
  lokalen Weboberfläche. Kein Kontingent, keine Cloud, keine Daten außerhalb deines Netzwerks.
- Eine Anmeldung pro Sitzung: Der Router beendet eine Sitzung nach ein paar Minuten ohne Nutzung, die
  Integration meldet sich von selbst neu an.
- Die Integration merkt sich unter `/data` nur die schon gesehenen MAC-Adressen, für den Auslöser
  „Unbekanntes Gerät verbunden“.

## Fehlerbehebung

- **„der Router antwortet unter dieser Adresse nicht“**: Prüfe die lokale IP-Adresse und ob Gladys
  im selben Netzwerk ist.
- **„keine Keenetic-Weboberfläche hier“**: Die Adresse zeigt auf ein anderes Gerät oder auf KeenDNS:
  Nutze die lokale Adresse.
- **„Benutzername oder Passwort vom Router abgelehnt“**: Prüfe beides unter **Benutzer und
  Zugriff**; die Integration versucht es alle fünf Minuten erneut, um das Protokoll des Routers nicht
  zu füllen.
- **„vom Router abgelehnt: Dem Benutzer fehlt dieses Recht“**: Dem Benutzer fehlt das Recht auf die
  Weboberfläche, oder er darf nur lesen und ein Befehl wurde verlangt.
- **Registriere dieses Gerät zuerst**: Um ein Gerät zu sperren, registriere es in den Gerätelisten
  des Routers.
- **Ein Handy erscheint abwesend, obwohl es zu Hause ist**: Erhöhe die Abwesenheitsverzögerung;
  manche Handys legen ihr WLAN lange schlafen.
- Mehr Details in den Protokollen der Integration mit `LOG_LEVEL=debug`.

## Grenzen

- Ohne die Hardware entwickelt: getestet mit echten Antworten eines Keenetic Ultra (KeeneticOS 5.1)
  und mit nach der KeeneticOS-Dokumentation nachgebauten Antworten, noch nicht an einem echten
  Router.
- KeeneticOS 5.2 bringt Zugriffstoken für Skripte auf dem Router; die Integration nutzt die
  Anmeldung der Weboberfläche, unter KeeneticOS 5.2 noch nicht geprüft.
- Einfaches HTTP im lokalen Netzwerk (die Weboberfläche des Routers hat kein lokales HTTPS); das
  Passwort wird nie übertragen, die Messwerte schon.
- Die WLAN-Clients zählen nur die Stationen des Routers selbst, nicht die der Mesh-Verstärker (sie
  sind online bei den verbundenen Geräten).
- Kein Verkehr pro Gerät, kein Signal des 4G-/5G-Modems, keine VPN-Steuerung: Die Integration ändert
  nur das Gäste-WLAN, den Internetzugang eines gewählten Geräts und startet den Router neu.

## Rückmeldungen

Fragen, ein Modell, das anders antwortet, eine Idee:
[github.com/guim31/gladys-keenetic/issues](https://github.com/guim31/gladys-keenetic/issues).
