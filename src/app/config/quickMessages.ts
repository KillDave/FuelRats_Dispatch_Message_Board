// Quick message templates for dispatch board buttons
// Edit the messages here — they'll update across the entire app.
// Use {clientName} for the client's name and {caseNumber} for the case number.
// Use trMessage for an alternative message when /tr translation mode is active
// (since /tr already prepends the client's name).

export interface PlatformVariants {
  pc?: string;          // Matches "PC" (Odyssey/Horizons)
  xbox?: string;        // Matches "Xbox"
  playstation?: string; // Matches "PlayStation"
  legacy?: string;      // Matches "Legacy" (PC Legacy)
  default?: string;     // Fallback if no platform match
}

export interface QuickMessage {
  label: string;
  message: string;                    // Default message (used as fallback)
  variants?: string[];                // If set, one is picked at random instead of 'message'
  trMessage?: string;                 // Alternative message when /tr is enabled
  trVariants?: string[];              // Random variants for /tr mode
  platformVariants?: PlatformVariants;   // Platform-specific message (overrides message/variants)
  trPlatformVariants?: PlatformVariants; // Platform-specific message for /tr mode
}

export interface QuickMessageGroup {
  label: string;
  messages?: QuickMessage[];
  subgroups?: QuickMessageGroup[];
  keepOpen?: boolean;  // If true, the popover stays open after a button is pressed
}

// Rescue popover buttons
export const rescueMessages: QuickMessage[] = [
  {
    label: 'Life Support',
    message: '{clientName}, please turn your Life Support on immediately: go to the right menu -> Modules tab, select Life Support and select Activate',
    trMessage: 'Please turn your Life Support on immediately: go to the right menu -> Modules tab, select Life Support and select Activate',
  },
  {
    label: 'Fuel',
    message: '{clientName}, you should be receiving fuel. Thank you for calling the Fuel Rats :D. Stick around with your rat in game for some fuel management advice.',
    trMessage: 'You should be receiving fuel. Thank you for calling the Fuel Rats :D. Stick around with your rat in game for some fuel management advice.',
  },
  {
    label: 'Failed',
    message: '{clientName}, sorry we couldn\'t get to you in time today :(. Your rat will be there for you after you respawn to help you with some tips and tricks, so please stick with them for a bit.',
    trMessage: 'Sorry we couldn\'t get to you in time today :(. Your rat will be there for you after you respawn to help you with some tips and tricks, so please stick with them for a bit.',
  },
];

// Dispatch popover buttons (nested subgroups)
export const dispatchMessages: QuickMessageGroup = {
  label: 'DISPATCH',
  subgroups: [
    {
      label: 'NORMAL',
      keepOpen: true,
      messages: [
        {
          label: '!PREP',
          message: '!prep {caseNumber}',
          variants: [
            '!prep {caseNumber}',
            '!oreo {caseNumber}'
          ]
        },
        {
          label: 'Welcome',
          message: '{clientName}, welcome to the Fuel Rats. Please let me know when you\'ve completed the instructions above. Alert me immediately if at any time a blue "oxygen depleted in …" timer counting down appears.',
          trMessage: 'Welcome to the Fuel Rats. Please let me know when you\'ve completed the instructions above. Alert me immediately if at any time a blue "oxygen depleted in …" timer counting down appears.',
        },
        {
          label: 'Modules',
          message: '{clientName}, please disable the following modules in the right menu: Cargo Hatch, everything in the hardpoints tab',
          trMessage: 'Please disable the following modules in the right menu: Cargo Hatch, everything in the hardpoints tab',
        },
      ],
    },
    {
      label: 'CODE RED',
      keepOpen: true,
      messages: [
        {
          label: 'Welcome',
          message: '{clientName}, welcome to the Fuel Rats. Please let me know that you\'re back in the main menu and can see your ship in the hanger. This will take 15 seconds to complete.',
          trMessage: 'Welcome to the Fuel Rats. Please let me know that you\'re back in the main menu and can see your ship in the hanger. This will take 15 seconds to complete.',
        },
        {
          label: '!CRINST',
          message: '!crinst {caseNumber}',
        },
        {
          label: '!TEAM',
          message: '!team {caseNumber}',
        },
        {
          label: '!BEACON',
          message: '!beacon {caseNumber}',
        },
        {
          label: 'CRINST - O2 Time',
          message: 'Then stay logged in, report back here with your oxygen time remaining, and stay here with me for further instructions.',
        },
        {
          label: 'CRINST - Video',
          message: 'Also if it helps, here\'s a video to show you the process: https://t.fuelr.at/odycr',
          platformVariants: {
            xbox: "Also if it helps, here\'s a video to show you the process:  https://t.fuelr.at/legcr",
            playstation: "Also if it helps, here\'s a video to show you the process:  https://t.fuelr.at/legcr",
            legacy: "Also if it helps, here\'s a video to show you the process:  https://t.fuelr.at/legcr",    
            default: "Also if it helps, here\'s a video to show you the process: https://t.fuelr.at/odycr"   
          }   
        },
        {
          label: 'CRINST - Ready',
          message: '{clientName} Let me know when you\'ve gone over all that and think you can do that quickly. Don\'t do it yet! Wait for my GO! signal! Just let me know when you\'re ready.',
          trMessage: 'Let me know when you\'ve gone over all that and think you can do that quickly. Don\'t do it yet! Wait for my GO! signal! Just let me know when you\'re ready.'
        },
        {
          label: 'GO! GO! GO!',
          message: 'Alright {clientName}, GO! GO! GO! 1) Log into open play. 2) Add your rat to a team. 3) Make sure your beacon is set to team. 4) Stay logged in and report back here with your oxygen time remaining. 5) Keep watching this channel and be ready to log out if I tell you!',
          trMessage: 'Alright, GO! GO! GO! 1) Log into open play. 2) Add your rat to a team. 3) Make sure your beacon is set to team. 4) Stay logged in and report back here with your oxygen time remaining. 5) Keep watching this channel and be ready to log out if I tell you!'
        },
        {
          label: 'CRINST - Video RU',
          message: 'Also if it helps, here\'s a video to show you the process: https://t.fuelr.at/odycrru',
        }
      ],
    },
    {
      label: 'OTHERS',
      messages: [
        {
          label: '!MULTI',
          message: '!multi {caseNumber}',
        },
        {
          label: '!REBOOT',
          message: '!reboot {caseNumber}',
        },
        {
          label: '!RTO',
          message: '!rto {caseNumber}',
        },
        {
          label: '!SC',
          message: '!sc {caseNumber}',
        },
      ],
    },
  ],
  // Top-level dispatch messages (not in a subgroup)
  messages: [
    {
      label: '!TEAM',
      message: '!team {caseNumber}',
    },
    {
      label: '!BEACON',
      message: '!beacon {caseNumber}',
    },
  ],
};
