const mockConnection = {
  execute: jest.fn().mockResolvedValue([[], []]),
  query: jest.fn().mockResolvedValue([]),
  end: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock("mysql2/promise", () => ({
  createConnection: jest.fn().mockResolvedValue(mockConnection),
}));
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed"),
  compare: jest.fn().mockResolvedValue(true),
}));

const { DB, Role } = require("../database/database");
const { StatusCodeError } = require("../endpointHelper");
const originalGetFranchise = DB.getFranchise;

function useResults(...results) {
  let index = 0;
  mockConnection.execute.mockImplementation(async () => [results[index++] || [], []]);
}

beforeEach(() => {
  mockConnection.execute.mockReset();
  mockConnection.query.mockClear();
  mockConnection.end.mockClear();
  mockConnection.beginTransaction.mockClear();
  mockConnection.commit.mockClear();
  mockConnection.rollback.mockClear();
  DB.getConnection = jest.fn().mockResolvedValue(mockConnection);
  DB.getFranchise = originalGetFranchise;
});

test("reads and writes menu items", async () => {
  useResults([{ id: 1, title: "Veggie" }], { insertId: 2 });
  expect(await DB.getMenu()).toEqual([{ id: 1, title: "Veggie" }]);
  expect(await DB.addMenuItem({ title: "Cheese", price: 1 })).toMatchObject({ id: 2 });
  expect(mockConnection.end).toHaveBeenCalledTimes(2);
});

test("adds users and assigns franchise and default roles", async () => {
  useResults({ insertId: 4 }, [{ id: 7 }], [], []);
  const user = await DB.addUser({ name: "diner", email: "d@test", password: "pw", roles: [{ role: Role.Franchisee, object: "shop" }, { role: Role.Admin }] });
  expect(user).toMatchObject({ id: 4, password: undefined });
  expect(mockConnection.execute).toHaveBeenCalledTimes(4);
});

test("gets users and rejects unknown credentials", async () => {
  useResults([{ id: 1, name: "A", password: "hashed" }], [{ objectId: 0, role: Role.Admin }]);
  expect(await DB.getUser("a@test", "pw")).toMatchObject({ id: 1, roles: [{ role: Role.Admin, objectId: undefined }] });
  useResults([]);
  await expect(DB.getUser("missing", "pw")).rejects.toBeInstanceOf(StatusCodeError);
  useResults([{ id: 1, password: "hashed" }]);
  require("bcrypt").compare.mockResolvedValueOnce(false);
  await expect(DB.getUser("a@test", "pw")).rejects.toThrow("unknown user");
});

test("updates and lists users with pagination", async () => {
  DB.getUser = jest.fn().mockResolvedValue({ id: 1, name: "new" });
  useResults([]);
  await DB.updateUser(1, "new", "new@test", "pw");
  expect(DB.getUser).toHaveBeenCalledWith("new@test", "pw");

  const users = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }];
  useResults(users, [{ role: Role.Diner, objectId: 0 }], [{ role: Role.Admin, objectId: 2 }]);
  expect((await DB.listUsers("bad", 2, "A*"))).toMatchObject({ more: true, users: [{ roles: [{ role: Role.Diner }] }, { roles: [{ role: Role.Admin, objectId: 2 }] }] });
});

test("deletes, logs in, and logs out users", async () => {
  useResults([], [], []);
  await DB.deleteUser(4);
  expect(mockConnection.commit).toHaveBeenCalled();
  mockConnection.beginTransaction.mockClear();
  mockConnection.execute.mockRejectedValueOnce(new Error("bad"));
  await expect(DB.deleteUser(4)).rejects.toThrow("bad");
  expect(mockConnection.rollback).toHaveBeenCalled();

  await DB.loginUser(1, "a.b.signature");
  useResults([{ userId: 1 }]);
  expect(await DB.isLoggedIn("a.b.signature")).toBe(true);
  await DB.logoutUser("a.b.signature");
  expect(DB.getTokenSignature("invalid")).toBe("");
});

test("handles orders and franchises", async () => {
  useResults([{ id: 1 }], [{ id: 9, menuId: 2 }]);
  expect(await DB.getOrders({ id: 3 }, 2)).toMatchObject({ dinerId: 3, orders: [{ items: [{ id: 9 }] }] });

  useResults({ insertId: 8 }, [{ id: 2 }]);
  expect(await DB.addDinerOrder({ id: 3 }, { franchiseId: 1, storeId: 2, items: [{ menuId: 2, price: 4 }] })).toMatchObject({ id: 8 });

  useResults([{ id: 5, name: "Admin" }], { insertId: 6 });
  const franchise = await DB.createFranchise({ name: "F", admins: [{ email: "a@test" }] });
  expect(franchise.id).toBe(6);
  useResults([]);
  await expect(DB.createFranchise({ name: "F", admins: [{ email: "missing" }] })).rejects.toThrow("unknown user");
});

test("lists franchise views and manages stores", async () => {
  useResults([{ id: 1, name: "F" }, { id: 2, name: "G" }], [{ id: 9, name: "S" }]);
  DB.getFranchise = jest.fn().mockImplementation(async (f) => ({ ...f, admins: [], stores: [] }));
  expect((await DB.getFranchises(null, 0, 1, "*"))[0]).toHaveLength(1);

  DB.getFranchise = originalGetFranchise;
  useResults([{ id: 1, name: "F" }]);
  expect(await DB.getFranchises({ isRole: () => true }, 0, 10, "F")).toEqual([[{ id: 1, name: "F", admins: [], stores: [] }], false]);
  useResults([]);
  expect(await DB.getUserFranchises(2)).toEqual([]);
  useResults([{ objectId: 4 }], [{ id: 4, name: "F" }]);
  expect(await DB.getUserFranchises(2)).toHaveLength(1);
  useResults([{ id: 1 }], [{ id: 2 }]);
  expect(await DB.getFranchise({ id: 4 })).toMatchObject({ admins: [{ id: 1 }], stores: [{ id: 2 }] });

  useResults({ insertId: 10 });
  expect(await DB.createStore(4, { name: "S" })).toEqual({ id: 10, franchiseId: 4, name: "S" });
  await DB.deleteStore(4, 10);
  expect(DB.getOffset(2, 10)).toBe(10);
});

test("executes low-level database helpers", async () => {
  useResults([{ id: 3 }], [{ id: 3 }]);
  expect(await DB.query(mockConnection, "SELECT", [])).toEqual([{ id: 3 }]);
  expect(await DB.getID(mockConnection, "name", "F", "franchise")).toBe(3);
  useResults([]);
  await expect(DB.getID(mockConnection, "name", "missing", "franchise")).rejects.toThrow("No ID found");
  expect(await DB.checkDatabaseExists(mockConnection)).toBe(false);
  expect(DB.getTokenSignature("a.b.c")).toBe("c");
});
