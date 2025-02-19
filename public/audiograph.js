import { assert, isPosInt } from './utils.js';
import { NODE_SCHEMA } from './model.js';
import * as synth from './synth.js';
import * as music from './music.js';

/**
 * Stateful graph that generates audio samples
 */
export class AudioGraph
{
    constructor(sampleRate, send)
    {
        assert (sampleRate == 44100);
        this.sampleRate = sampleRate;

        // Current playback position in seconds
        this.playPos = 0;

        // Compiled code to generate audio samples
        this._genSample = null;

        // Method to send messages to the main thread
        this.send = send;

        // Stateful audio processing nodes, indexed by nodeId
        this.nodes = [];
    }

    /**
     * Update the audio graph given a new compiled unit
     */
    newUnit(unit)
    {
        // Note that we don't delete any nodes, even if existing nodes are
        // currently not listed in the compiled unit, because currently
        // disconnected nodes may get reconnected, and deleting things like
        // delay lines would lose their current state.
        // All nodes get garbage collected when the playback is stopped.

        // For each audio node
        for (let nodeId in unit.nodes)
        {
            let nodeState = unit.nodes[nodeId];

            let nodeClass = (
                nodeState.type in NODE_CLASSES?
                NODE_CLASSES[nodeState.type]:
                AudioNode
            );

            // If a node with this nodeId is already mapped
            if (this.nodes[nodeId])
            {
                let node = this.nodes[nodeId];

                // The existing node must have the same type
                assert (node instanceof nodeClass);

                // Update the node's state
                node.setState(nodeState);
            }
            else
            {
                // Create a new audio node
                this.nodes[nodeId] = new nodeClass(
                    nodeId,
                    nodeState,
                    this.sampleRate,
                    this.send
                );
            }
        }

        // Create the sample generation function
        this._genSample = new Function(
            'time',
            'nodes',
            unit.src
        );
    }

    /**
     * Parse a message from the main thread
     */
    parseMsg(msg)
    {
        let node = ('nodeId' in msg)? this.nodes[msg.nodeId]:null;

        switch (msg.type)
        {
            case 'NEW_UNIT':
            this.newUnit(msg.unit);
            break;

            case 'SET_PARAM':
            node.setParam(msg.paramName, msg.value);
            break;

            case 'SET_STATE':
            node.setState(msg.state);
            break;

            case 'SET_CELL':
            node.setCell(msg.patIdx, msg.stepIdx, msg.rowIdx, msg.value);
            break;

            case 'QUEUE_PATTERN':
            node.queuePattern(msg.patIdx, msg.patData);
            break;

            case 'NOTE_ON':
            node.noteOn(msg.noteNo, msg.velocity);
            break;

            default:
            throw new TypeError('unknown message type');
        }
    }

    /**
     * Generate one [left, right] pair of audio samples
     */
    genSample()
    {
        if (!this._genSample)
            return [0, 0];

        this.playPos += 1 / 44100;
        return this._genSample(this.playPos, this.nodes);
    }
}

/**
 * Base class for stateful audio processing nodes
 */
class AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        this.nodeId = id;
        this.state = state;
        this.params = state.params;
        this.sampleRate = sampleRate;
        this.sampleTime = 1 / sampleRate;
        this.send = send;
    }

    /**
     * Set a parameter value on a given node
     */
    setParam(paramName, value)
    {
        assert (paramName in this.params);
        this.params[paramName] = value;
    }

    /**
     * Set/update the entire state for this node
     */
    setState(state)
    {
        this.state = state;
        this.params = state.params;
    }
}

/**
 * ADSR envelope
 */
class ADSRNode extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);
        this.env = new synth.ADSREnv();
    }

    update(time, gate, attack, decay, susVal, release)
    {
        return this.env.eval(time, gate, attack, decay, susVal, release)
    }
}

/**
 * Clock source, with tempo in BPM
 */
class Clock extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);
        this.phase = 0;
    }

    update()
    {
        let freq = music.CLOCK_PPQ * this.params.value / 60;
        let duty = 0.5;
        this.phase += this.sampleTime * freq;
        let cyclePos = this.phase % 1;
        return (cyclePos < duty)? -1:1;
    }
}

/**
 * Clock signal divider
 */
class ClockDiv extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Last clock sign at the input (positive/negative)
        this.inSgn = false;

        // Current clock sign at the output (positive/negative)
        this.outSgn = false;

        // Number of input ticks since the last output tick
        this.clockCnt = 0;
    }

    update(clock)
    {
        // Current clock sign at the input
        let curSgn = (clock > 0);

        // If the clock sign just flipped
        if (this.inSgn != curSgn)
        {
            // If we're outputting zero, we have to count rising edges,
            // but if we're outputting one, we have to count falling edges
            if (curSgn != this.outSgn)
            {
                this.clockCnt++;
            }

            // If we've reached the current count
            if (this.clockCnt >= this.params.factor)
            {
                // Reset the clock count
                this.clockCnt = 0;

                // Flip the output clock sign
                this.outSgn = !this.outSgn;
            }
        }

        this.inSgn = curSgn;

        return this.outSgn? 1:-1;
    }
}

/**
 * Delay line node
 */
class Delay extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Stateful delay line object
        this.delay = new synth.Delay(sampleRate);
    }
}

/**
 * Overdrive-style distortion
 */
class Distort extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);
    }

    update(input, amount)
    {
        return synth.distort(input, amount);
    }
}

/**
 * Sample and hold
 */
class Hold extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Value currently being held
        this.value = 0;

        // Current trig input sign (positive/negative)
        this.trigSgn = false;
    }

    update(input, trig)
    {
        if (!this.trigSgn && trig > 0)
            this.value = input;

        this.trigSgn = (trig > 0);

        return this.value;
    }
}

/**
 * Pulse wave oscillator
 */
class PulseOsc extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        this.phase = 0;
    }

    update(freq, duty)
    {
        this.phase += this.sampleTime * freq;
        let cyclePos = this.phase % 1;
        return (cyclePos < duty)? -1:1;
    }
}

/**
 * Sawtooth wave oscillator
 */
class SawOsc extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Current time position
        this.phase = 0;
    }

    update(freq)
    {
        this.phase += this.sampleTime * freq;
        let cyclePos = this.phase % 1;
        return -1 + 2 * cyclePos;
    }
}

/**
 * Sine wave oscillator
 */
class SineOsc extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Current time position
        this.phase = 0;

        // Current sync input sign (positive/negative)
        this.syncSgn = false;
    }

    update(freq, sync)
    {
        let minVal = this.params.minVal;
        let maxVal = this.params.maxVal;

        if (!this.syncSgn && sync > 0)
            this.phase = 0;

        this.syncSgn = (sync > 0);

        let cyclePos = this.phase % 1;
        this.phase += this.sampleTime * freq;

        let v = Math.sin(cyclePos * 2 * Math.PI);
        let normVal = (v + 1) / 2;

        return minVal + normVal * (maxVal - minVal);
    }
}

/**
 * Triangle wave oscillator
 */
class TriOsc extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Current time position
        this.phase = 0;
    }

    update(freq)
    {
        this.phase += this.sampleTime * freq;
        let cyclePos = this.phase % 1;

        if (cyclePos < 0.5)
            return -1 + (4 * cyclePos);

        return 1 - (4 * (cyclePos - 0.5));
    }
}

/**
 * Scope to plot incoming signals
 */
class Scope extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        const SEND_SIZE = NODE_SCHEMA.Scope.sendSize;
        const SEND_RATE = NODE_SCHEMA.Scope.sendRate;

        // How often to gather samples
        this.sampleInterv = sampleRate / (SEND_SIZE * SEND_RATE);
        assert (isPosInt(this.sampleInterv));

        // Buffer of samples to be send
        this.buffer = new Array(SEND_SIZE);

        // How many samples we've seen in total
        this.numSamples = 0;

        // How many samples we have ready to send
        this.numReady = 0;
    }

    update(inVal)
    {
        if (this.numSamples % this.sampleInterv == 0)
        {
            this.buffer[this.numReady] = inVal;
            this.numReady++;

            if (this.numReady == this.buffer.length)
            {
                // Send the current step back to the main thread
                this.send({
                    type: 'SEND_SAMPLES',
                    nodeId: this.nodeId,
                    samples: this.buffer
                });

                this.numReady = 0;
            }
        }

        this.numSamples++;
    }
}

/**
 * Slide/portamento node
 */
class Slide extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Current state
        this.s = 0;
    }

    update(input, rate)
    {
        // Remap so the useful range is around [0, 1]
        rate = rate * 1000;

        if (rate < 1)
            rate = 1;

        this.s += (1 / rate) * (input - this.s);

        return this.s;
    }
}

/**
 * Two-pole low-pass filter
 */
 class Filter extends AudioNode
 {
     constructor(id, state, sampleRate, send)
     {
         super(id, state, sampleRate, send);

         this.filter = new synth.TwoPoleFilter();
     }

     update(input, cutoff, reso)
     {
        return this.filter.apply(input, cutoff, reso);
     }
}

/**
 * Midi input node with freq and gate outputs
 */
class MidiIn extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Current note being held
        this.noteNo = 0;

        // Frequency of the note being held
        this.freq = 0;

        // Current gate state
        this.gateState = 'off';
    }

    noteOn(noteNo, velocity)
    {
        if (velocity > 0)
        {
            this.noteNo = noteNo;
            this.freq = music.Note(noteNo).getFreq();
            this.gateState = 'pretrig';
        }
        else
        {
            if (noteNo == this.noteNo)
            {
                this.noteNo = 0;
                this.gateState = 'off';
            }
        }
    }

    update()
    {
        // The pretrig state serves to force the gate to go to
        // zero for at least one cycle so that ADSR envelopes
        // can be retriggered if already active.
        switch (this.gateState)
        {
            case 'pretrig':
            this.gateState = 'on';
            return [0, 0];

            case 'on':
            return [this.freq, 1];

            case 'off':
            return [this.freq, 0];

            default:
            assert (false);
        }
    }
}

/**
 * Monophonic note sequencer
 */
class MonoSeq extends AudioNode
{
    constructor(id, state, sampleRate, send)
    {
        super(id, state, sampleRate, send);

        // Current clock sign (positive/negative)
        this.clockSgn = false;

        // Number of clock ticks until the next step is triggered
        this.clockCnt = 0;

        // Next step to trigger
        this.nextStep = 0;

        // Time the last note was triggered
        this.trigTime = 0;

        // Frequency of the note being held
        this.freq = 0;

        // Current gate state
        this.gateState = 'off';

        // Currently playing pattern
        this.patIdx = state.curPattern;

        // Next pattern that is queued for playback
        this.nextPat = undefined;

        // Generate the scale notes
        this.scale = music.genScale(state.scaleRoot, state.scaleName, state.numOctaves);
    }

    /**
     * Set/update the entire state for this node
     */
    setState(state)
    {
        AudioNode.prototype.setState.call(this, state);

        // Generate the scale notes
        this.scale = music.genScale(state.scaleRoot, state.scaleName, state.numOctaves);

        this.patIdx = state.curPattern;
    }

    /**
     * Set a given cell in a step sequencer
     */
    setCell(patIdx, stepIdx, rowIdx, value)
    {
        let pattern = this.state.patterns[patIdx];
        let numRows = pattern[stepIdx].length;

        for (let i = 0; i < numRows; ++i)
            pattern[stepIdx][i] = 0;

        pattern[stepIdx][rowIdx] = value;
    }

    /**
     * Queue the next pattern to play
     */
    queuePattern(patIdx, patData)
    {
        console.log(`got queuePattern, patIdx=${patIdx}`);

        this.state.patterns[patIdx] = patData;
        this.nextPat = patIdx;
    }

    /**
     * Takes the current time and clock signal as input.
     * Produces frequency and gate signals as output.
     */
    update(time, clock, gateTime)
    {
        if (!this.clockSgn && clock > 0)
        {
            // If we are at the beginning of a new sequencer step
            if (this.clockCnt == 0)
            {
                var grid = this.state.patterns[this.patIdx];

                this.clockCnt = music.CLOCK_PPS;
                var stepIdx = this.nextStep % grid.length;
                this.nextStep++;

                // Send the current step back to the main thread
                this.send({
                    type: 'SET_CUR_STEP',
                    nodeId: this.nodeId,
                    stepIdx: stepIdx
                });

                for (var rowIdx = 0; rowIdx < this.scale.length; ++rowIdx)
                {
                    if (!grid[stepIdx][rowIdx])
                        continue

                    let note = this.scale[rowIdx];
                    this.freq = note.getFreq();
                    this.gateState = 'pretrig';
                    this.trigTime = time;
                }

                // If this is the last step of this pattern
                if (stepIdx === grid.length - 1)
                {
                    this.nextStep = 0;

                    if (this.nextPat !== undefined)
                    {
                        // Send the pattern change to the main thread
                        this.send({
                            type: 'SET_PATTERN',
                            nodeId: this.nodeId,
                            patIdx: this.nextPat
                        });

                        // Move to the next pattern
                        this.patIdx = this.nextPat;
                        this.nextPat = undefined;
                    }
                }
            }

            this.clockCnt--;
        }

        // Store the sign of the clock signal for this cycle
        this.clockSgn = (clock > 0);

        assert (!isNaN(this.freq), 'MonoSeq freq is NaN');

        // The pretrig state serves to force the gate to go to
        // zero for at least one cycle so that ADSR envelopes
        // can be retriggered if already active.
        switch (this.gateState)
        {
            case 'off':
            return [this.freq, 0];

            case 'pretrig':
            this.gateState = 'on';
            return [0, 0];

            case 'on':
            {
                // If we are past the end of the note
                if (time - this.trigTime > gateTime)
                {
                    this.gateState = 'off';
                    this.trigTime = 0;
                }

                return [this.freq, 1];
            }

            default:
            assert (false);
        }
    }
}

/**
 * Map of node types to classes
 */
let NODE_CLASSES =
{
    ADSR: ADSRNode,
    Clock: Clock,
    ClockDiv: ClockDiv,
    Delay: Delay,
    Distort: Distort,
    Hold: Hold,
    Pulse: PulseOsc,
    Saw: SawOsc,
    Sine: SineOsc,
    Tri: TriOsc,
    Scope: Scope,
    Slide: Slide,
    Filter: Filter,
    MidiIn: MidiIn,
    MonoSeq: MonoSeq,
};
