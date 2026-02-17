// Quick message templates for dispatch board buttons
// Edit the messages here — they'll update across the entire app.
// Use {clientName} for the client's name and {caseNumber} for the case number.
// Use trMessage for an alternative message when /tr translation mode is active
// (since /tr already prepends the client's name).

export interface QuickMessage {
  label: string;
  message: string;
  trMessage?: string; // Alternative message when /tr is enabled
}

export interface QuickMessageGroup {
  label: string;
  messages?: QuickMessage[];
  subgroups?: QuickMessageGroup[];
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
      messages: [
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
      messages: [
        {
          label: 'Welcome',
          message: '{clientName}, welcome to the Fuel Rats. DO NOT LOGOUT or QUIT to menu. Please complete the instructions above ASAP and let me know when done.',
          trMessage: 'Welcome to the Fuel Rats. DO NOT LOGOUT or QUIT to menu. Please complete the instructions above ASAP and let me know when done.',
        },
        {
          label: '!CRINST',
          message: '!crinst {caseNumber}',
        },
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
