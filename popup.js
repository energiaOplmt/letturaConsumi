window.onload = async function () {
    document.getElementById("sendApi").addEventListener("click", sendApi);
    document.getElementById("autoconsumoLink").addEventListener("click", () => {
        chrome.tabs.create({ url: "https://github.com/energiaOplmt/letturaConsumi" });
    });
    // document.getElementById("linkConsumi").addEventListener("click", () => {
    //     chrome.tabs.create({ url: "https://private.e-distribuzione.it/PortaleClienti/s/curvedicarico" });
    // });
};

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

async function sendApi() {

    getCurrentTab().then(async (tab) => {
        if (tab) {
            // const response = await chrome.runtime.sendMessage({ action: "getReqData" });
            if (tab.url !== "https://private.e-distribuzione.it/PortaleClienti/s/curvedicarico") {
                chrome.notifications.create({
                    type: "basic",
                    iconUrl: "icon.png",
                    title: "Errore",
                    message: "Non sei sulla pagina dei consumi. Per favore, vai sulla pagina dei consumi e riprova",
                });
                return;
            }
            const response = await chrome.storage.local.get(["body", "headerData", "cookie"]);
            console.log("response:", response);
            if (response && Object.keys(response).length > 0) {
                //elimino i dati dalla cache
                chrome.storage.local.remove(["body", "headerData", "cookie"]);
                document.getElementById("sendApi").disabled = true;
                document.getElementById("sendApi").style.display = "none";
                document.getElementById("status").style.display = "block";
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: sendApiToPage,
                    args: [response],
                });
            } else {
                chrome.notifications.create({
                    type: "basic",
                    iconUrl: "icon.png",
                    title: "Errore",
                    message: "Non trovo la pagina. Cliccare su un punto qualsiasi della pagina e riprovare",
                });
            }
        } else {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon.png",
                title: "Errore",
                message: "Non trovo i dati necessari. Aggiornare la pagina e riprovare",
            });
        }
    });
}

async function sendApiToPage(response) {
    console.log("response:", response);

    const mesiDaScaricare = 2;
    const cicliDaSvolgere = 18 / mesiDaScaricare;
    const csvArray = [];
    let firstEndDate = '';
    let lastStartDate = '';

    const {
        body: {
            message,
            "aura.context": auraContext,
            "aura.pageURI": auraPageURI,
            "aura.token": auraToken
        },
        headerData,
        cookie
    } = response;

    const bodyMessage = JSON.parse(message);
    const bodyAuraContext = JSON.parse(auraContext);
    const context = {
        bodyMessage,
        bodyAuraContext,
        auraPageURI,
        auraToken,
        headerData,
        cookie,
        csvArray,
        mesiDaScaricare
    }
    showSpinner();
    await getEnergia(context, cicliDaSvolgere, true);


    //functions

    async function getEnergia(context, times, firstTime = false) {
        if (times > 0) {
            let { bodyMessage, bodyAuraContext, auraPageURI, auraToken, headerData, cookie, csvArray, mesiDaScaricare } = context;
            //aggiorno le date

            let startDate = new Date(bodyMessage.actions[0].params.Startdate);
            let endDate = new Date(bodyMessage.actions[0].params.Enddate);

            if (firstTime) {
                //se è la prima volta che chiamo la funzione, setto la data di fine al giorno corrente e quella di inizio a x mesi prima
                const today = new Date();
                endDate = today;
                startDate = new Date(today);
                startDate.setMonth(startDate.getMonth() - (mesiDaScaricare - 1));
                startDate.setDate(1);
                firstEndDate = new Date(endDate - endDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            } else {
                //tolgo un giorno alla data di inizio per evitare di scaricare due volte lo stesso giorno
                const tempEndDate = new Date(startDate);
                tempEndDate.setDate(tempEndDate.getDate() - 1);
                const tempStartDate = new Date(startDate);
                tempStartDate.setMonth(tempStartDate.getMonth() - mesiDaScaricare);
                startDate = new Date(tempStartDate);
                endDate = new Date(tempEndDate);
                if (times === 1) {
                    lastStartDate = new Date(startDate - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
                }
            }

            const startDateString = new Date(startDate - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            const endDateString = new Date(endDate - endDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            bodyMessage.actions[0].params.Startdate = startDateString;
            bodyMessage.actions[0].params.Enddate = endDateString;

            console.log(`startDate: ${startDateString}, endDate: ${endDateString}`);

            const fetchObj = {
                "headers": {
                    ...headerData,
                    "cookie": cookie,
                    "Referer": "https://private.e-distribuzione.it/PortaleClienti/s/curvedicarico",
                    "Referrer-Policy": "origin-when-cross-origin"
                },
                "body": `message=${encodeURIComponent(JSON.stringify(bodyMessage))}&aura.context=${encodeURIComponent(JSON.stringify(bodyAuraContext))}&aura.pageURI=${encodeURIComponent(auraPageURI)}&aura.token=${encodeURIComponent(auraToken)}`,
                "method": "POST",
                "mode": "cors",
                "credentials": "include"
            };
            try {
                const energiaResult = await fetch("https://private.e-distribuzione.it/PortaleClienti/s/sfsites/aura?r=4&other.PED_CurveDiCarico.QueryLoadProfile=1", fetchObj);
                const energia = await energiaResult.json();
                const valueArray = getValueArray(energia);
                csvArray.push(valueArray);
                setTimeout(async () => {
                    await getEnergia(context, times - 1);
                }, 20000 + Math.floor(Math.random() * 3000));
            } catch (e) {
                console.log("Errore:", e);
                alert("Errore. Aggiornare la pagina e riprovare. Se il problema persiste, contattare l'autore");
            }
        } else {
            const csv = convertToCSV(csvArray);
            hideSpinner();
            downloadCSV(csv);
        }
    }


    function getValueArray(energia) {
        const valueArray = [];
        const { MappaDailyLoadProfile: values } = energia.actions[0].returnValue;
        //values è un oggetto con chiavi come data (AAAAMM-GG) e un altro oggetto come valore
        //il secondo oggetto ha chiavi di id e valori di energia
        //aggiungo la data come primo valore dell'array e per ogni valore aggiungo i valori di energia
        for (const [date, value] of Object.entries(values)) {
            const valueRow = [date];
            for (const [id, energy] of Object.entries(value)) {
                valueRow.push(parseFloat(energy));
            }
            valueArray.push(valueRow);
        }
        return valueArray;
    }

    function convertToCSV(array) {
        let csv = '';
        const quarters = ["Giorno", ...generateQuarterHours()];
        csv += quarters.join(';');
        csv += "\n";
        array.flat().forEach(row => {
            csv += row.join(';');
            csv += "\n";
        });
        return csv;
    }

    function generateQuarterHours() {
        var quarterHours = [];
        for (var hour = 0; hour < 24; hour++) {
            for (var minute = 0; minute < 60; minute += 15) {
                var startHour = hour.toString().padStart(2, '0');
                var startMinute = minute.toString().padStart(2, '0');
                var endHour = (minute === 45) ? (hour === 23 ? '00' : (hour + 1).toString().padStart(2, '0')) : startHour;
                var endMinute = (minute === 45) ? '00' : (minute + 15).toString().padStart(2, '0');
                quarterHours.push(startHour + ':' + startMinute + '-' + endHour + ':' + endMinute);
            }
        }
        return quarterHours;
    }


    function downloadCSV(csv) {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `CurvaDiCarico_da_${lastStartDate}_a_${firstEndDate}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Funzione per aggiungere lo spinner alla pagina
    function showSpinner() {
        // Create a div for the spinner
        var spinnerWrapper = document.createElement('div');
        spinnerWrapper.id = 'spinner-wrapper';
        spinnerWrapper.style.position = 'fixed';
        spinnerWrapper.style.width = '100%';
        spinnerWrapper.style.height = '100%';
        spinnerWrapper.style.top = '0';
        spinnerWrapper.style.left = '0';
        spinnerWrapper.style.zIndex = '1000';
        spinnerWrapper.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
        spinnerWrapper.style.display = 'flex';
        spinnerWrapper.style.flexDirection = 'column'; // Ensure children are stacked vertically
        spinnerWrapper.style.alignItems = 'center';
        spinnerWrapper.style.justifyContent = 'center';

        // Add a spinner element to the wrapper
        var spinner = document.createElement('div');
        spinner.style.border = '16px solid #f3f3f3';
        spinner.style.borderTop = '16px solid #3498db';
        spinner.style.borderRadius = '50%';
        spinner.style.width = '120px';
        spinner.style.height = '120px';
        spinner.style.animation = 'spin 2s linear infinite';

        // Add the spinner animation
        var keyframes = document.createElement('style');
        keyframes.innerHTML = '@keyframes spin {0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }}';
        document.head.appendChild(keyframes);

        // Add a text element below the spinner
        var text = document.createElement('div');
        text.style.fontSize = '20px';
        text.style.fontWeight = 'bold';
        text.style.textAlign = 'center';
        text.style.fontFamily = 'Arial, Helvetica, sans-serif';
        text.style.textTransform = 'uppercase';
        text.style.letterSpacing = '2px';
        text.style.marginTop = '20px';
        text.style.color = '#BB4430';
        text.innerHTML = 'Scaricamento degli ultimi 18 mesi in corso, non chiudere o ricaricare la pagina. Tempo stimato: 3 minuti';

        // Assemble everything and add to body
        spinnerWrapper.appendChild(spinner); // Spinner added first
        spinnerWrapper.appendChild(text); // Text added second, so it's below the spinner
        document.body.appendChild(spinnerWrapper);
    }


    // Funzione per rimuovere lo spinner dalla pagina
    function hideSpinner() {
        var spinnerWrapper = document.getElementById('spinner-wrapper');
        if (spinnerWrapper) {
            spinnerWrapper.parentNode.removeChild(spinnerWrapper);
        }
    }

}
