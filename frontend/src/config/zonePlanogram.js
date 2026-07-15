// Expected book layout for the demo shelf (planogram).
// Zones follow the live monitor grid: rows A (top) to C (bottom), columns 1-5.
// When an empty space is detected in a zone, the book listed here is the one
// that MAY be missing - the model detects gaps, it does not read book titles.
export const zonePlanogram = {
  A1: "The Kane Chronicles: The Throne of Fire",
  A2: "Imagine Me",
  A3: "Twisted Love",
  A4: "Restore Me",
  A5: "Defy Me",

  B1: "The Greek Myths",
  B2: "Twisted Hate",
  B3: "Ignite Me",
  B4: "Unravel Me",
  B5: "Shatter Me",

  C1: "The Kane Chronicles: The Serpent's Shadow",
  C2: "Me Before You",
  C3: "Amazing Grace",
  C4: "The Kane Chronicles: The Red Pyramid",
  C5: "Star",
};
