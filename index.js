const { type } = require('os');
const puppeteer = require('puppeteer');
fs = require('fs');

const baseUrl = 'https://onlineradiobox.com/North-America/';

/**
 * Log everything to file for later reference
 */
var trueLog = console.log;
console.log = function(msg) {
    fs.appendFile("output.log", `[${new Date().toISOString()}] ${msg}\n`, function(err) {
        if(err) {
            return trueLog(err);
        }
    });
    trueLog(msg);
}

/**
 * Test scraping for single radio page
 */
async function singlePageTest() {
    console.log("📻 Running test");
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await disableAssetLoading(page);
    await scrapeSinglePage(null, page, 'http://localhost:5000/test-single');
    await browser.close();
    process.exit();
}

/**
 * Main entry point
 */
(async () => {
    /**
     * For testing, uncomment this. Make sure to run `npm run serve .` to start testserver
     */ 
    // await singlePageTest();

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const stream = fs.createWriteStream("output.txt", {flags:'a'});

    console.log("📻 Starting!");

    await page.goto(baseUrl, {waitUntil: 'networkidle2'});
    // let skipTo = 'https://onlineradiobox.com/us'; // Optional skip to a certain page

    // Don't load assets
    await disableAssetLoading(page);

    countries = await page.evaluate(() => {
        const countriesList = document.querySelectorAll("ul.countries__countries-list li");
        return [...countriesList].filter(li => li.querySelector("a")).map(li => li.querySelector("a").href)
    });

    for (const country of countries) {
        // Goto first page of country
        let nextUrl = country; 

        // Optionally skip to country
        if (skipTo) {
            if (skipTo !== country) {
                continue;
            } else {
                skipTo = false;
            }
        }

        await page.goto(nextUrl, {waitUntil: 'networkidle2'});
        console.log("📻 Fetching first page of " + country);

        while(nextUrl) {
            nextUrl = await hasNextPage(page);
    
            // Fetch radio links on this page
            const stationsUrls = await page.evaluate(() => {
                const stationListEl = document.querySelectorAll("ul.stations-list li");
                return [...stationListEl].filter(li => li.querySelector("figure a")).map(li => li.querySelector("figure a").href)
            });
    
            for (const url of stationsUrls) {
                await scrapeSinglePage(stream, page, url);
            }
    
            if (nextUrl) {
                console.log("📻 Fetching next page: " + nextUrl);
                await page.goto(nextUrl, {waitUntil: 'networkidle2'});
            }
        }
    }

    stream.end();

    await browser.close();
})();

/**
 * Don't load extra assets we don't need like images, stylesheets and scripts
 * 
 * @param { Promise } page 
 */
async function disableAssetLoading(page) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (['image', 'stylesheet', 'font', 'script'].indexOf(request.resourceType()) !== -1) {
            request.abort();
        } else {
            request.continue();
        }
    });
}

/**
 * Check if current page still has a next page
 * 
 * @param { Promise } page 
 */
async function hasNextPage(page) {
    const nextPageLink = await page.evaluate(() => {
        const el = document.querySelectorAll('dl.pagination dd');
        const links = [...el].map(dd => dd.querySelector('a')?.href);
        return links[links.length - 1];
    });

    return nextPageLink ? nextPageLink : false
}

/**
 * Scrapes a page for the contents. 
 * 
 * @param { fs.Writestream } stream 
 * @param { Promise } page 
 * @param { string } url 
 */
async function scrapeSinglePage(stream, page, url) {
    await page.goto(url, {waitUntil: 'networkidle2'});

    const { name, email, likes, tags, website, language, location, facebook, twitter, description, phone, additionalInfo } = await getRadioData(page);
    if (email) {
        const line = `\
${name}~\
${email}~\
${location.join(",")}~\
${likes}~\
${website}~\
${phone}~\
${facebook}~\
${twitter}~\
${language}~\
${tags.join(",")}~\
${additionalInfo}~\
${url}~\
${description}~\
        `
        if (stream) {
            stream.write(line + "\n");
        }
        console.log('✅ ' + line);
    } else {
        console.log(url + ' has no email address listed');
    }
}

/**
 * This function knows where to find stuff on a single radio page
 * 
 * @param { Promise } page 
 */
async function getRadioData(page) {
    const data = await page.evaluate(() => {
        const email = document.querySelector('p[itemprop="email"] a')?.textContent;

        if (!email) {
            return {};
        }

        const name = document.querySelector('h1[itemprop="name"]')?.textContent;
        const tagsEl = document.querySelectorAll('ul.station__tags li');
        const tags = [...tagsEl].map(li => li.querySelector('a')?.textContent);
        const likes = document.querySelector('span.i-chart[title="rating"]')?.textContent;
        const website = document.querySelector('a[itemprop="url"]')?.href;
        const phone = document.querySelector('p[itemprop="telephone"]')?.textContent.replace("Phone:","").trim();
        const description = document.querySelector('div[itemprop="description"]')?.innerHTML.replace(/(\r\n|\n|\r)/gm,"");
        const facebook = document.querySelector('a.i-fb--reference')?.href;
        const twitter = document.querySelector('a.i-tw--reference')?.href;
        const additionalInfo = document.querySelector('p[itemprop="additionalProperty"]')?.innerHTML.replace(/(\r\n|\n|\r)/gm,"");
        const language = document.querySelector('li.station__reference__lang a')?.textContent;

        // Get locations
        const locationEl = document.querySelectorAll('ul.breadcrumbs li');
        let locationArr = [...locationEl];
        locationArr.pop(); // Remove last element (station name)
        const location = locationArr.map(li => li.querySelector('a span')?.textContent);

        return { name, email, tags, likes, website, language, location, facebook, twitter, description, phone, additionalInfo };
    });

    return data;
}