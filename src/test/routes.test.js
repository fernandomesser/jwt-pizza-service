const request = require("supertest");
const jwt = require("jsonwebtoken");

jest.mock("../metrics", () => ({
  requestTracker: (req, res, next) => next(),
  recordAuthAttempt: jest.fn(),
  recordPizzaPurchase: jest.fn(),
}));
jest.mock("../database/database", () => ({
  Role: { Diner: "diner", Franchisee: "franchisee", Admin: "admin" },
  DB: {
    isLoggedIn: jest.fn().mockResolvedValue(true),
    addUser: jest.fn(async (user) => ({ ...user, id: 3, password: undefined })),
    loginUser: jest.fn(),
    getUser: jest.fn(async () => ({ id: 3, name: "Diner", email: "d@test", roles: [{ role: "diner" }] })),
    logoutUser: jest.fn(),
    getMenu: jest.fn().mockResolvedValue([{ id: 1, title: "Veggie" }]),
    addMenuItem: jest.fn(),
    getOrders: jest.fn().mockResolvedValue({ dinerId: 3, orders: [], page: 1 }),
    addDinerOrder: jest.fn(async (user, order) => ({ ...order, id: 9 })),
    getFranchises: jest.fn().mockResolvedValue([[{ id: 1, name: "F" }], false]),
    getUserFranchises: jest.fn().mockResolvedValue([{ id: 1, name: "F" }]),
    createFranchise: jest.fn(async (franchise) => ({ ...franchise, id: 1 })),
    deleteFranchise: jest.fn(),
    getFranchise: jest.fn().mockResolvedValue({ id: 1, admins: [{ id: 3 }], stores: [] }),
    createStore: jest.fn().mockResolvedValue({ id: 2, name: "S" }),
    deleteStore: jest.fn(),
    updateUser: jest.fn().mockResolvedValue({ id: 3, name: "Updated", roles: [] }),
    deleteUser: jest.fn(),
    listUsers: jest.fn().mockResolvedValue({ users: [], more: false }),
  },
}));

const app = require("../service");
const { DB } = require("../database/database");
const config = require("../config");

function token(roles = ["diner"], id = 3) {
  return jwt.sign({ id, name: "Diner", email: "d@test", roles: roles.map((role) => ({ role })) }, config.jwtSecret);
}

function auth(role = "diner", id = 3) {
  return { Authorization: `Bearer ${token([role], id)}` };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ reportUrl: "url", jwt: "factory" }) });
});

afterAll(() => delete global.fetch);

test("serves root, docs, and unknown endpoints", async () => {
  expect((await request(app).get("/")).body.message).toBe("welcome to JWT Pizza");
  expect((await request(app).get("/api/docs")).body.endpoints.length).toBeGreaterThan(0);
  expect((await request(app).get("/missing")).status).toBe(404);
});

test("registers, logs in, and logs out users", async () => {
  expect((await request(app).post("/api/auth").send({})).status).toBe(400);
  expect((await request(app).post("/api/auth").send({ name: "D", email: "d@test", password: "p" })).status).toBe(200);
  expect((await request(app).put("/api/auth").send({ email: "d@test", password: "p" })).status).toBe(200);
  expect((await request(app).delete("/api/auth")).status).toBe(401);
  expect((await request(app).delete("/api/auth").set(auth())).status).toBe(200);
});

test("serves user endpoints and authorization branches", async () => {
  expect((await request(app).get("/api/user/me").set(auth())).status).toBe(200);
  expect((await request(app).put("/api/user/4").set(auth()).send({ name: "x" })).status).toBe(403);
  expect((await request(app).put("/api/user/3").set(auth()).send({ name: "x" })).status).toBe(200);
  expect((await request(app).get("/api/user").set(auth())).status).toBe(403);
  expect((await request(app).get("/api/user").set(auth("admin"))).status).toBe(200);
  expect((await request(app).delete("/api/user/3").set(auth())).status).toBe(403);
  expect((await request(app).delete("/api/user/3").set(auth("admin"))).status).toBe(200);
});

test("serves menu and order endpoints", async () => {
  expect((await request(app).get("/api/order/menu")).status).toBe(200);
  expect((await request(app).put("/api/order/menu").set(auth()).send({})).status).toBe(403);
  expect((await request(app).put("/api/order/menu").set(auth("admin")).send({ title: "New" })).status).toBe(200);
  expect((await request(app).get("/api/order").set(auth())).status).toBe(200);
  expect((await request(app).post("/api/order").set(auth()).send({ items: [{ price: 2, quantity: 2 }] })).status).toBe(200);

  global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ reportUrl: "failed" }) });
  expect((await request(app).post("/api/order").set(auth()).send({ items: [] })).status).toBe(500);
  global.fetch.mockRejectedValueOnce(new Error("factory down"));
  expect((await request(app).post("/api/order").set(auth()).send({ items: [] })).status).toBe(500);
});

test("serves franchise endpoints and checks permissions", async () => {
  expect((await request(app).get("/api/franchise")).status).toBe(200);
  expect((await request(app).get("/api/franchise/3").set(auth())).status).toBe(200);
  expect((await request(app).get("/api/franchise/4").set(auth())).body).toEqual([]);
  expect((await request(app).post("/api/franchise").set(auth()).send({})).status).toBe(403);
  expect((await request(app).post("/api/franchise").set(auth("admin")).send({ name: "F", admins: [] })).status).toBe(200);
  expect((await request(app).delete("/api/franchise/1")).status).toBe(200);
  expect((await request(app).post("/api/franchise/1/store").set(auth()).send({ name: "S" })).status).toBe(200);
  expect((await request(app).delete("/api/franchise/1/store/2").set(auth())).status).toBe(200);
  DB.getFranchise.mockResolvedValueOnce(null);
  expect((await request(app).post("/api/franchise/1/store").set(auth()).send({ name: "S" })).status).toBe(403);
});
