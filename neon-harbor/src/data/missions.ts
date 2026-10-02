// Declarative mission scripts. The MissionSystem interprets these; adding a mission requires
// no code. All characters, places, businesses and dialogue are original to Neon Harbor.
//
// Story: Kai Delacroix comes home to Neon Harbor after three years upstate and starts building
// the Tidewater crew, squeezed between the Saltline Crew (harbor smugglers), the Velvet Kings
// (nightclub owners) and Councilman Edmund Thale, who quietly owns half the police budget.

import type { Faction } from '../sim/Actor';
import type { InteriorId } from './pois';
import type { WeaponId } from './weapons';

export type TargetDef =
	| { poi: string; fwd?: number; side?: number }
	| { lane: [number, number]; ahead?: number }
	| { pier: number; along: number; side?: number }
	| { ref: string; side?: number }
	| { interior: string; at: 'counter' | 'entry' | 'exit' };

export interface DialogueLine {
	who: string;
	text: string;
	time?: number;
}

export type ActionDef =
	| { do: 'spawnVehicle'; ref: string; model: string; at: TargetDef; heading?: number | 'lane'; color?: number }
	| { do: 'spawnGroup'; ref: string; faction: Faction; count: number; at: TargetDef; spread?: number; weapon: WeaponId; hostile?: boolean; health?: number; accuracy?: number; leader?: { health: number; weapon: WeaponId } }
	| { do: 'spawnAlly'; ref: string; at: TargetDef; weapon?: WeaponId; health?: number; shirt?: number; hair?: number; name?: string }
	| { do: 'spawnDriver'; ref: string; faction?: Faction }
	| { do: 'flee'; ref: string }
	| { do: 'spawnPickup'; ref: string; at: TargetDef; label: string; color?: number }
	| { do: 'setWanted'; level: number }
	| { do: 'give'; weapon: WeaponId; ammo: number }
	| { do: 'notify'; text: string }
	| { do: 'say'; lines: DialogueLine[] }
	| { do: 'remove'; ref: string };

export type FailDef =
	| { if: 'dead'; ref: string; reason: string }
	| { if: 'destroyed'; ref: string; reason: string }
	| { if: 'far'; ref: string; distance: number; seconds: number; reason: string };

export interface CheckpointDef {
	player: TargetDef;
	heading?: number;
	/** Recreate whatever this and later objectives need. */
	actions?: ActionDef[];
	/** Seat the player in this vehicle ref after restoring. */
	inVehicle?: string;
}

interface ObjectiveBase {
	text: string;
	setup?: ActionDef[];
	after?: ActionDef[];
	timeLimit?: number;
	failIf?: FailDef[];
	checkpoint?: CheckpointDef;
}

export type ObjectiveDef = ObjectiveBase &
	(
		| { type: 'goto'; target: TargetDef; radius?: number; vehicle?: string; withAlly?: string; onFoot?: boolean; requireNoWanted?: boolean }
		| { type: 'enterVehicle'; vehicle: string }
		| { type: 'eliminate'; group: string }
		| { type: 'protect'; ally: string; group: string }
		| { type: 'chase'; vehicle: string; escape: number }
		| { type: 'collect'; pickup: string }
		| { type: 'loseWanted' }
		| { type: 'hold'; target: TargetDef; radius: number; seconds: number; intimidate?: boolean }
		| { type: 'wait'; seconds: number }
		| { type: 'enterInterior'; poi: string }
		| { type: 'exitInterior' }
	);

export interface MissionDef {
	id: string;
	title: string;
	/** POI id where the mission is started. */
	contact: string;
	contactName: string;
	summary: string;
	requires: string[];
	reward: number;
	/** Property unlocked for free on completion. */
	unlockProperty?: string;
	/** Interior that may be entered while wanted during this mission. */
	allowInterior?: InteriorId;
	intro: DialogueLine[];
	outro: DialogueLine[];
	failIf?: FailDef[];
	objectives: ObjectiveDef[];
}

const PRIYA_LOOK = { shirt: 0x6a3a8a, hair: 0x111111 };

export const MISSIONS: MissionDef[] = [
	{
		id: 'low_tide',
		title: 'Low Tide',
		contact: 'contact_rosa',
		contactName: 'Rosa Calloway',
		summary: "The Saltline Crew lifted Rosa's delivery van. Bring it home.",
		requires: [],
		reward: 1500,
		intro: [
			{ who: 'Rosa', text: "Kai Delacroix. Three years and you still walk in like you own the booth." },
			{ who: 'Rosa', text: "Saltline boys took my delivery van off the Coral Mile last night. Parked it on their pier like a trophy." },
			{ who: 'Kai', text: "And you want it back without anybody getting hurt." },
			{ who: 'Rosa', text: "I want it back. The rest is up to you, honey." },
		],
		outro: [
			{ who: 'Rosa', text: "Not a scratch. Your father would've dented it twice." },
			{ who: 'Rosa', text: "Here. Seed money. You're going to need friends in this town." },
		],
		objectives: [
			{
				type: 'goto',
				text: 'Go to the Saltline pier in the harbor.',
				target: { pier: 1, along: 0.12 },
				radius: 14,
				setup: [
					{ do: 'spawnVehicle', ref: 'van', model: 'van', at: { pier: 1, along: 0.42, side: -9 }, heading: Math.PI / 2, color: 0xe8e8e8 },
					{ do: 'spawnGroup', ref: 'guards', faction: 'saltline', count: 3, at: { pier: 1, along: 0.6, side: -4 }, spread: 7, weapon: 'pistol', hostile: false },
				],
			},
			{ type: 'enterVehicle', text: "Take back Rosa's van.", vehicle: 'van', failIf: [{ if: 'destroyed', ref: 'van', reason: "Rosa's van was destroyed." }] },
			{
				type: 'goto',
				text: "Drive the van to Calloway's Diner.",
				target: { poi: 'contact_rosa', fwd: 7 },
				radius: 7,
				vehicle: 'van',
				failIf: [{ if: 'destroyed', ref: 'van', reason: "Rosa's van was destroyed." }],
				checkpoint: {
					player: { pier: 1, along: 0.3 },
					actions: [{ do: 'spawnVehicle', ref: 'van', model: 'van', at: { pier: 1, along: 0.3 }, heading: -Math.PI / 2, color: 0xe8e8e8 }],
					inVehicle: 'van',
				},
			},
		],
	},
	{
		id: 'static',
		title: 'Static on the Line',
		contact: 'contact_priya',
		contactName: 'Priya "Static" Nair',
		summary: 'Courier a stolen data drive across town. Someone talked.',
		requires: ['low_tide'],
		reward: 2500,
		intro: [
			{ who: 'Priya', text: "Rosa says you're quiet and you drive like a lunatic. Perfect." },
			{ who: 'Priya', text: 'I have a drive full of shipping manifests. My buyer is in Meridian and hates waiting.' },
			{ who: 'Kai', text: "What's on it?" },
			{ who: 'Priya', text: "Proof that half the cargo on Saltline's piers never clears customs. Don't drop it." },
		],
		outro: [{ who: 'Priya', text: "Buyer's happy, cops are bored, and you're officially useful. Talk soon." }],
		objectives: [
			{
				type: 'collect',
				text: 'Pick up the data drive at Static Electronics.',
				pickup: 'drive',
				setup: [{ do: 'spawnPickup', ref: 'drive', at: { poi: 'contact_priya', fwd: 2.2, side: 1 }, label: 'Data drive', color: 0x3affd8 }],
				after: [
					{ do: 'setWanted', level: 2 },
					{ do: 'say', lines: [{ who: 'Priya', text: "Scanner's lighting up. Somebody tipped NHPD. Lose them before you go anywhere near the buyer!" }] },
				],
			},
			{ type: 'loseWanted', text: 'Lose the police.', checkpoint: { player: { poi: 'contact_priya', fwd: 3 }, actions: [{ do: 'setWanted', level: 2 }] } },
			{
				type: 'goto',
				text: 'Deliver the drive to the buyer in Meridian.',
				target: { poi: 'store_meridian', fwd: 5 },
				radius: 6,
				requireNoWanted: true,
				timeLimit: 300,
			},
		],
	},
	{
		id: 'velvet_rope',
		title: 'Velvet Rope',
		contact: 'contact_rosa',
		contactName: 'Rosa Calloway',
		summary: "Escort Priya to a sit-down at the Afterglow. It's a setup.",
		requires: ['static'],
		reward: 3000,
		intro: [
			{ who: 'Rosa', text: 'The Velvet Kings want to meet Priya at the Afterglow. Neutral ground, they say.' },
			{ who: 'Kai', text: 'Nothing is neutral after midnight.' },
			{ who: 'Rosa', text: "That's why you're going with her. She's waiting outside." },
		],
		outro: [
			{ who: 'Priya', text: "Lionel Ash just declared war on a hacker with a grudge. That was his second mistake." },
			{ who: 'Priya', text: 'The first was missing you.' },
		],
		failIf: [{ if: 'dead', ref: 'priya', reason: 'Priya was killed.' }],
		objectives: [
			{
				type: 'goto',
				text: 'Meet Priya outside the diner.',
				target: { poi: 'contact_rosa', fwd: 3, side: 3 },
				radius: 4,
				setup: [{ do: 'spawnAlly', ref: 'priya', at: { poi: 'contact_rosa', fwd: 3, side: 4 }, weapon: 'pistol', health: 260, ...PRIYA_LOOK, name: 'Priya' }],
			},
			{
				type: 'goto',
				text: 'Take Priya to the Afterglow Nightclub.',
				target: { poi: 'prop_nightclub', fwd: 4 },
				radius: 10,
				withAlly: 'priya',
				checkpoint: { player: { poi: 'contact_rosa', fwd: 3 }, actions: [{ do: 'spawnAlly', ref: 'priya', at: { poi: 'contact_rosa', fwd: 3, side: 2 }, weapon: 'pistol', health: 260, ...PRIYA_LOOK, name: 'Priya' }] },
			},
			{ type: 'wait', text: 'Wait for the Velvet Kings.', seconds: 4, setup: [{ do: 'say', lines: [{ who: 'Priya', text: "They're late. Kings are never late." }, { who: 'Kai', text: 'Get behind me.' }] }] },
			{
				type: 'protect',
				text: 'Ambush! Protect Priya.',
				ally: 'priya',
				group: 'wave1',
				setup: [{ do: 'spawnGroup', ref: 'wave1', faction: 'velvet', count: 4, at: { poi: 'prop_nightclub', fwd: 18, side: 16 }, spread: 7, weapon: 'smg', hostile: true, accuracy: 0.35 }],
				checkpoint: { player: { poi: 'prop_nightclub', fwd: 4 }, actions: [{ do: 'spawnAlly', ref: 'priya', at: { poi: 'prop_nightclub', fwd: 3, side: 2 }, weapon: 'pistol', health: 260, ...PRIYA_LOOK, name: 'Priya' }] },
			},
			{
				type: 'protect',
				text: 'More of them coming from the alley!',
				ally: 'priya',
				group: 'wave2',
				setup: [{ do: 'spawnGroup', ref: 'wave2', faction: 'velvet', count: 4, at: { poi: 'prop_nightclub', fwd: 14, side: -18 }, spread: 7, weapon: 'pistol', hostile: true, accuracy: 0.4 }],
			},
			{ type: 'goto', text: 'Get Priya back to Static Electronics.', target: { poi: 'contact_priya', fwd: 5 }, radius: 8, withAlly: 'priya' },
		],
	},
	{
		id: 'paper_trail',
		title: 'Paper Trail',
		contact: 'contact_marco',
		contactName: 'Marco Vell',
		summary: "Run down Councilman Thale's courier and take the ledgers.",
		requires: ['velvet_rope'],
		reward: 3500,
		intro: [
			{ who: 'Marco', text: "I run these docks for Saltline, but I don't work for them. Remember that." },
			{ who: 'Marco', text: "Councilman Thale's courier leaves Meridian every Thursday with the books. Today's Thursday." },
			{ who: 'Kai', text: 'And the books are worth more than the car.' },
			{ who: 'Marco', text: 'The books are worth more than this whole pier. Bring them to Rosa, not me.' },
		],
		outro: [{ who: 'Rosa', text: "Names, dates, payoffs. Thale's been feeding Saltline for years. We just got leverage." }],
		objectives: [
			{ type: 'goto', text: 'Get to Meridian to intercept the courier.', target: { lane: [80, -560] }, radius: 40 },
			{
				type: 'chase',
				text: "Run the courier's car off the road.",
				vehicle: 'courier',
				escape: 280,
				setup: [
					{ do: 'spawnVehicle', ref: 'courier', model: 'limo', at: { lane: [80, -560], ahead: 35 }, heading: 'lane', color: 0x101012 },
					{ do: 'spawnDriver', ref: 'courier' },
					{ do: 'flee', ref: 'courier' },
				],
				failIf: [{ if: 'far', ref: 'courier', distance: 280, seconds: 8, reason: 'The courier got away.' }],
			},
			{
				type: 'collect',
				text: 'Grab the ledgers from the wreck.',
				pickup: 'ledger',
				setup: [{ do: 'spawnPickup', ref: 'ledger', at: { ref: 'courier', side: 3 }, label: 'Ledgers', color: 0xffd84a }],
			},
			{ type: 'goto', text: "Bring the ledgers to Rosa's diner.", target: { poi: 'contact_rosa', fwd: 4 }, radius: 6, requireNoWanted: true },
		],
	},
	{
		id: 'gilded_gull',
		title: 'The Gilded Gull',
		contact: 'contact_rosa',
		contactName: 'Rosa Calloway',
		summary: "Hit the exchange that launders Thale's money.",
		requires: ['paper_trail'],
		reward: 8000,
		allowInterior: 'exchange',
		intro: [
			{ who: 'Rosa', text: "The ledgers say Thale washes his money through the Gilded Gull Exchange on the boardwalk." },
			{ who: 'Rosa', text: 'Friday night the till is fat. Nobody gets hurt, you understand me?' },
			{ who: 'Kai', text: "Point, wait, walk. Nobody's a hero for a councilman's cash." },
		],
		outro: [{ who: 'Rosa', text: "Eight grand of Thale's dirty money, clean in our hands. He'll feel that." }],
		objectives: [
			{ type: 'enterInterior', text: 'Go inside the Gilded Gull Exchange.', poi: 'exchange', setup: [{ do: 'give', weapon: 'pistol', ammo: 24 }] },
			{ type: 'hold', text: 'Aim at the clerk until the till is empty.', target: { interior: 'exchange', at: 'counter' }, radius: 3, seconds: 7, intimidate: true },
			{
				type: 'exitInterior',
				text: 'Get out!',
				setup: [{ do: 'say', lines: [{ who: 'Clerk', text: "Silent alarm's already tripped, genius. Enjoy the sirens." }] }],
				after: [{ do: 'setWanted', level: 3 }],
			},
			{ type: 'loseWanted', text: 'Lose the police.', checkpoint: { player: { poi: 'exchange', fwd: 3 }, actions: [{ do: 'setWanted', level: 3 }] } },
			{ type: 'goto', text: 'Lay low at the Tidewater Flat.', target: { poi: 'safehouse', fwd: 2 }, radius: 4, requireNoWanted: true },
		],
	},
	{
		id: 'tidewater_rising',
		title: 'Tidewater Rising',
		contact: 'contact_marco',
		contactName: 'Marco Vell',
		summary: 'Take Pier 9 from the Saltline Crew for good.',
		requires: ['gilded_gull'],
		reward: 10000,
		unlockProperty: 'prop_warehouse',
		intro: [
			{ who: 'Marco', text: "Dutch Varga knows about the ledgers. He's pulling everything out of the Pier 9 warehouse tonight." },
			{ who: 'Marco', text: "My guys will back you. Take the pier and it's yours. I'll keep the forklifts running." },
			{ who: 'Kai', text: 'Tidewater crew. I like the sound of that.' },
		],
		outro: [
			{ who: 'Marco', text: "Varga's done. Pier 9 Warehouse is yours, deed and all." },
			{ who: 'Rosa', text: "Welcome home, Kai. Now the hard part starts: keeping it." },
		],
		objectives: [
			{
				type: 'goto',
				text: "Meet Marco's crew at the foot of Pier 9.",
				target: { pier: 2, along: 0.06 },
				radius: 14,
				setup: [
					{ do: 'give', weapon: 'rifle', ammo: 120 },
					{ do: 'spawnAlly', ref: 'crew1', at: { pier: 2, along: 0.03, side: 6 }, weapon: 'rifle', health: 220, shirt: 0x1f5a5a, name: 'Crew' },
					{ do: 'spawnAlly', ref: 'crew2', at: { pier: 2, along: 0.03, side: -6 }, weapon: 'rifle', health: 220, shirt: 0x1f5a5a, name: 'Crew' },
				],
			},
			{
				type: 'eliminate',
				text: 'Clear the Saltline Crew off the pier.',
				group: 'yard',
				setup: [{ do: 'spawnGroup', ref: 'yard', faction: 'saltline', count: 6, at: { pier: 2, along: 0.45 }, spread: 12, weapon: 'smg', hostile: true, accuracy: 0.4 }],
				checkpoint: {
					player: { pier: 2, along: 0.05 },
					actions: [
						{ do: 'give', weapon: 'rifle', ammo: 90 },
						{ do: 'spawnAlly', ref: 'crew1', at: { pier: 2, along: 0.03, side: 6 }, weapon: 'rifle', health: 220, shirt: 0x1f5a5a, name: 'Crew' },
					],
				},
			},
			{
				type: 'eliminate',
				text: 'Take down Dutch Varga.',
				group: 'boss',
				setup: [
					{ do: 'spawnGroup', ref: 'boss', faction: 'saltline', count: 3, at: { pier: 2, along: 0.85 }, spread: 6, weapon: 'rifle', hostile: true, accuracy: 0.45, leader: { health: 450, weapon: 'shotgun' } },
					{ do: 'say', lines: [{ who: 'Dutch Varga', text: "Delacroix! Your old man didn't know when to quit either!" }] },
				],
			},
			{ type: 'goto', text: 'Report back to Marco at the harbor office.', target: { poi: 'contact_marco', fwd: 3 }, radius: 5 },
		],
	},
];

export function missionDef(id: string): MissionDef | undefined {
	return MISSIONS.find((m) => m.id === id);
}
