import {Annealer} from 'fathom-web/optimizers';


/**
 * Awaitable setDefault that stores Promise values, not the Promises
 * themselves, in the map
 */
async function asyncSetDefault(map, key, asyncDefaultMaker) {
    if (map.has(key)) {
        return map.get(key);
    }
    const defaultValue = await asyncDefaultMaker();
    map.set(key, defaultValue);
    return defaultValue;
}

class Tuner extends Annealer {
    constructor(tabs, trainableId) {
        super(5000, 1, .95, 1);  // TODO: Remove. This is just for shortening PoC runtimes.
        this.tabs = tabs;
        this.trainableId = trainableId;
    }

    // Copy-and-pasted from Fathom just to allow solutionCost() to be async.
    // What color is your function?
    async anneal() {
        let temperature = this.INITIAL_TEMPERATURE;
        let currentSolution = this.initialSolution();
        let bestSolution = currentSolution;
        let currentCost = await this.solutionCost(currentSolution);
        let bestCost = currentCost;
        let m = 0;
        let n = 0;
        let hits = 0, misses = 0;
        const seenSolutions = new Map();  // solution => cost
        for (let i = 0; i < this.COOLING_STEPS; i++) {
            console.log('Cooling step', i, 'of', this.COOLING_STEPS, '...');
            const startCost = currentCost;
            for (let j = 0; j < this.STEPS_PER_TEMP; j++) {
                let newSolution = this.randomTransition(currentSolution);
                if (seenSolutions.has(newSolution.toString())) {
                    hits += 1;
                } else {
                    misses += 1;
                }
                let newCost = await asyncSetDefault(seenSolutions, newSolution.toString(), () => this.solutionCost(newSolution));

                if (newCost < currentCost) {
                    // Always take improvements.
                    currentCost = newCost;
                    currentSolution = newSolution;
                    if (newCost < bestCost) {
                        bestCost = newCost;
                        bestSolution = newSolution;
                        console.log('New best solution is ', newSolution, ' with cost ', newCost);
                    }
                } else {
                    // Sometimes take non-improvements.
                    const minusDelta = currentCost - newCost;
                    const merit = Math.exp(minusDelta / (this.BOLTZMANNS * temperature));
                    if (merit > Math.random()) {
                        m++;
                        currentCost = newCost;
                        currentSolution = newSolution;
                    }
                }
                n++;
                // Exit if we're not moving:
                if (startCost === currentCost) { break; }
            }
            temperature *= this.COOLING_FRACTION;
        }
        console.log('Iterations:', n, 'using', m, 'jumps.');
        console.log('Cache hits', hits, 'misses', misses);
        console.log('Cache hit rate', hits/(hits + misses));
        return bestSolution;
    }

    async solutionCost(coeffs) {
        // Send a message to all the pages in the corpus, telling them "Run
        // ruleset ID X (which carries its own right/wrong determiner which
        // itself knows what query to run), and tell me whether it was right or
        // wrong."
        succeededs = await Promise.all(this.tabs.map(
            tab => browser.tabs.sendMessage(tab.id,
                                            {type: 'rulesetSucceeded',
                                             trainableId: this.trainableId,
                                             coeffs})));
        let successes = 0;
        for (const succeeded of succeededs) {
            if (succeeded) {
                successes += 1;
            }
            console.log(succeeded);
        }

        // When all complete, combine for a total score:
        return successes / tabs.length;
    }

    randomTransition(solution) {
        return [1];
    }

    initialSolution() {
        return [1];
    }
}

async function trainOnTabs() {
    // Grey out Train button:
    document.getElementById('train').disabled = true;

    // TODO: Using "active" here rather than a tab ID presents a race condition
    // if you quickly switch away from the tab after clicking the Train button.
    const tabs = (await browser.tabs.query({currentWindow: true, active: false}));
    //await setViewportSize(tabs[0], 1024, 768);  // for consistent element sizing in samples due to text wrap, etc.

    const tuner = new Tuner(tabs, 'overlay');
    const tunedCoeffs = await tuner.anneal();


    // Clean up:
    document.getElementById('train').disabled = false;
}
document.getElementById('train').onclick = trainOnTabs;
