const express = require("express");
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// index.js
const decoded = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFireBaseToken = async (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  // verify token
  try {
    const userInfo = await admin.auth().verifyIdToken(token);
    req.token_email = userInfo.email;
    console.log("after token validation", userInfo);
    next();
  } catch {
    console.log("invalid token");
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@keramot.mqb48yw.mongodb.net/?retryWrites=true&w=majority&appName=Keramot`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    //await client.connect();
    const db = client.db("krishi-db");
    const productCollection = db.collection("products");
    const usersCollection = db.collection("users");

    // users apis
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const email = req.body.email;
      const query = { email: email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        res.send({
          message: "user already exits. Do not need to insert again",
        });
      } else {
        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      }
    });

    // GET user profile
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json(user);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // UPDATE user profile
    app.put("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const updatedInfo = req.body;

        const result = await usersCollection.findOneAndUpdate(
          { email },
          { $set: updatedInfo },
          { returnDocument: "after" }
        );

        if (!result) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    //Get posts by user email
    app.get("/products/byOwner/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "owner.ownerEmail": email };

      const result = await productCollection.find(query).toArray();
      res.send(result);
    });

    // Get latest 6 products
    app.get("/products/latest", async (req, res) => {
      try {
        const result = await productCollection
          .find()
          .sort({ createdAt: -1 }) // newest first
          .limit(6)
          .toArray();

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Failed to fetch latest crops" });
      }
    });

    // Update product
    app.put("/products/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await productCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.send(result);
    });

    // Delete product
    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;

      const result = await productCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // GET All Crops with search support
    app.get("/products", async (req, res) => {
      try {
        const search = req.query.search || "";

        const query = {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { type: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ],
        };

        const crops = await productCollection.find(query).toArray();
        res.send(crops);
      } catch (error) {
        console.error("Error fetching crops:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    app.get("/products", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query["owner.ownerEmail"] = email;
      }

      const result = await productCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/products/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.findOne(query);
      console.log(result);
      res.send(result);
    });

    //add crops to db

    app.post("/products", async (req, res) => {
      const cropData = req.body;

      const result = await productCollection.insertOne(cropData);

      res.send(result);
    });

    // ADD INTEREST TO A CROP
    app.post("/interests", async (req, res) => {
      try {
        const interest = req.body;
        const cropId = interest.cropId;

        // Check if user has already sent interest
        const already = await productCollection.findOne({
          _id: new ObjectId(cropId),
          "interests.userEmail": interest.userEmail,
        });

        if (already) {
          return res.status(400).json({
            error: "You have already sent an interest for this crop",
          });
        }

        // Create unique _id for interest
        const interestId = new ObjectId();

        const newInterest = {
          _id: interestId, // ← generates i5544 style ID
          cropId: cropId,
          userEmail: interest.userEmail,
          userName: interest.userName,
          quantity: interest.quantity,
          message: interest.message,
          status: "pending", // ← default
        };

        // Push into interests array
        const result = await productCollection.updateOne(
          { _id: new ObjectId(cropId) },
          { $push: { interests: newInterest } }
        );

        res.json({ inserted: result.modifiedCount > 0 });
      } catch (err) {
        res.status(500).json({ error: "Server error", details: err });
      }
    });

    app.get("/my-interests/:email", async (req, res) => {
      try {
        const email = req.params.email;

        // Find crops where this user has interests
        const crops = await productCollection
          .find({ "interests.userEmail": email })
          .toArray();

        // Extract only user's interest objects + crop info
        const formatted = crops.map((crop) => {
          const userInterest = crop.interests.find(
            (i) => i.userEmail === email
          );

          return {
            cropId: crop._id,
            cropName: crop.name,
            ownerName: crop.owner.ownerName,
            ownerEmail: crop.owner.ownerEmail,
            quantity: userInterest.quantity,
            message: userInterest.message,
            status: userInterest.status,
          };
        });

        res.send(formatted);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    // PATCH update interest status + reduce crop quantity if accepted
    app.patch("/interests/status/:interestId", async (req, res) => {
      const interestId = req.params.interestId;
      const { status } = req.body;

      try {
        // 1. Find the product containing this interest
        const product = await productCollection.findOne({
          "interests._id": new ObjectId(interestId),
        });

        if (!product) {
          return res
            .status(404)
            .send({ error: true, message: "Product not found" });
        }

        // 2. Find the interest object
        const interest = product.interests.find(
          (i) => i._id.toString() === interestId
        );

        if (!interest) {
          return res
            .status(404)
            .send({ error: true, message: "Interest not found" });
        }

        // 3. Base update (status only)
        let updateQuery = {
          $set: { "interests.$.status": status },
        };

        // 4. If ACCEPTED → reduce product quantity
        if (status === "accepted") {
          updateQuery.$inc = { quantity: -interest.quantity };
        }

        // 5. Update DB
        const result = await productCollection.updateOne(
          { "interests._id": new ObjectId(interestId) },
          updateQuery
        );

        res.send({ modified: result.modifiedCount > 0 });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ error: true, message: "Failed to update status" });
      }
    });

    //await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!!!");
});

app.get("/muhin", (req, res) => {
  res.send("welcome to my server");
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
