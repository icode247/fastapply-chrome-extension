import * as React from "react";
import { Link } from "react-router-dom"; // Import Link from react-router-dom
import List from "@mui/joy/List";
import ListItem from "@mui/joy/ListItem";
import ListItemButton from "@mui/joy/ListItemButton";
import ListItemContent from "@mui/joy/ListItemContent";

export default function Navigation() {
  return (
    <List
      size="sm"
      sx={{ "--ListItem-radius": "var(--joy-radius-sm)", "--List-gap": "4px" }}
    >
      <ListItem nested>
        <List
          aria-labelledby="nav-list-browse"
          sx={{ "& .JoyListItemButton-root": { p: "8px" } }}
        >
          <ListItem>
            <ListItemButton component={Link} to="/">
              {" "}
              {/* Use Link from react-router-dom */}
              <ListItemContent>Home</ListItemContent>
            </ListItemButton>
          </ListItem>
          <ListItem>
            <ListItemButton component={Link} to="/pricing">
              {" "}
              {/* Use Link from react-router-dom */}
              <ListItemContent>Pricing</ListItemContent>
            </ListItemButton>
          </ListItem>
          <ListItem>
            <ListItemButton component={Link} to="/how-it-works">
              {" "}
              {/* Use Link from react-router-dom */}
              <ListItemContent>How it works</ListItemContent>
            </ListItemButton>
          </ListItem>
        </List>
      </ListItem>
    </List>
  );
}
