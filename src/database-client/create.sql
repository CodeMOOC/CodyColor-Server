-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: database
-- Generation Time: Sep 29, 2025 at 11:29 PM
-- Server version: 8.4.6
-- PHP Version: 8.2.27

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

--
-- Database: `CodyColor`
--

-- --------------------------------------------------------

--
-- Table structure for table `GameMatches`
--

CREATE TABLE `GameMatches` (
  `Id` int UNSIGNED NOT NULL,
  `SessionId` int UNSIGNED NOT NULL,
  `BeginTimestamp` datetime NOT NULL,
  `NumUsers` tinyint UNSIGNED DEFAULT '2'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `GameSessions`
--

CREATE TABLE `GameSessions` (
  `Id` int UNSIGNED NOT NULL,
  `NumMatches` tinyint UNSIGNED NOT NULL,
  `Type` char(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `BeginTimestamp` datetime NOT NULL,
  `MatchDurationMs` mediumint UNSIGNED DEFAULT '30000'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `MatchParticipants`
--

CREATE TABLE `MatchParticipants` (
  `SessionId` int UNSIGNED NOT NULL,
  `MatchId` int UNSIGNED NOT NULL,
  `Ordinal` smallint UNSIGNED NOT NULL,
  `Nickname` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `UserId` varbinary(64) DEFAULT NULL,
  `Registered` bit(1) DEFAULT b'0',
  `BeginTimestamp` datetime NOT NULL,
  `Score` tinyint UNSIGNED NOT NULL,
  `PathLength` smallint UNSIGNED NOT NULL,
  `TimeMs` mediumint UNSIGNED NOT NULL,
  `Winner` bit(1) DEFAULT b'0',
  `IsWallUser` bit(1) DEFAULT b'0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Users`
--

CREATE TABLE `Users` (
  `Id` varbinary(64) NOT NULL,
  `Email` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Nickname` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Anonymous',
  `Deleted` bit(1) DEFAULT b'0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `WallUsers`
--

CREATE TABLE `WallUsers` (
  `Id` varbinary(64) NOT NULL,
  `Name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'Anonymous',
  `Surname` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'Anonymous',
  `Deleted` bit(1) DEFAULT b'0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `GameMatches`
--
ALTER TABLE `GameMatches`
  ADD PRIMARY KEY (`Id`),
  ADD UNIQUE KEY `MatchId_idx` (`Id`),
  ADD KEY `SessionId_idx` (`SessionId`);

--
-- Indexes for table `GameSessions`
--
ALTER TABLE `GameSessions`
  ADD PRIMARY KEY (`Id`);

--
-- Indexes for table `MatchParticipants`
--
ALTER TABLE `MatchParticipants`
  ADD PRIMARY KEY (`SessionId`,`MatchId`,`Ordinal`) USING BTREE,
  ADD KEY `SessionId_idx` (`SessionId`),
  ADD KEY `MatchId_idx` (`MatchId`),
  ADD KEY `Score_idx` (`Score`),
  ADD KEY `ScorePerDay_idx` (`BeginTimestamp`,`Score`),
  ADD KEY `Path_idx` (`PathLength`),
  ADD KEY `PathPerDay_idx` (`BeginTimestamp`,`PathLength`);

--
-- Indexes for table `Users`
--
ALTER TABLE `Users`
  ADD PRIMARY KEY (`Id`);

--
-- Indexes for table `WallUsers`
--
ALTER TABLE `WallUsers`
  ADD PRIMARY KEY (`Id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `GameMatches`
--
ALTER TABLE `GameMatches`
  MODIFY `Id` int UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `GameSessions`
--
ALTER TABLE `GameSessions`
  MODIFY `Id` int UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `GameMatches`
--
ALTER TABLE `GameMatches`
  ADD CONSTRAINT `fk_GameMatches_SessionId` FOREIGN KEY (`SessionId`) REFERENCES `GameSessions` (`Id`);

--
-- Constraints for table `MatchParticipants`
--
ALTER TABLE `MatchParticipants`
  ADD CONSTRAINT `fk_MatchParticipants_MatchId` FOREIGN KEY (`MatchId`) REFERENCES `GameMatches` (`Id`),
  ADD CONSTRAINT `fk_MatchParticipants_SessionId` FOREIGN KEY (`SessionId`) REFERENCES `GameSessions` (`Id`);
COMMIT;
